"""
AccessGuru FastAPI Application
Provides endpoints for accessibility violation prediction and SHAP explanations
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Any
import numpy as np
import pandas as pd
import xgboost as xgb

# NOTE: SHAP / NumPy compatibility shim (you had this already)
np.obj2sctype = lambda obj: np.dtype(obj).type

import shap
import pickle
import re
from bs4 import BeautifulSoup
import warnings
import os

warnings.filterwarnings("ignore")

# -----------------------------
# FastAPI app
# -----------------------------
app = FastAPI(
    title="AccessGuru ML API",
    description="Accessibility violation prediction and explainability API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Globals
model: xgb.Booster | None = None
artifacts: dict | None = None
explainer: shap.TreeExplainer | None = None


# -----------------------------
# Schemas
# -----------------------------
class PredictionInput(BaseModel):
    affected_html_elements: str = Field(..., description="HTML snippet with accessibility violation")
    supplementary_information: str = Field(..., description="Additional HTML context")
    violation_name: str = Field(..., description="Name of the violation")
    wcag_reference: str = Field(..., description="WCAG reference code")
    web_URL: str = Field(..., description="URL of the webpage")
    domain_category: str = Field(..., description="Domain category (e.g., education, government)")

    class Config:
        json_schema_extra = {
            "example": {
                "affected_html_elements": '<img src="logo.png">',
                "supplementary_information": '<div><img src="logo.png"></div>',
                "violation_name": "missing alt text",
                "wcag_reference": "WCAG 1.1.1 (A)",
                "web_URL": "https://example.com/page",
                "domain_category": "education",
            }
        }


class PredictionOutput(BaseModel):
    predicted_score: int = Field(..., description="Predicted violation score (2-5)")
    prediction_probability: float = Field(..., description="Confidence of the prediction")
    all_probabilities: Dict[int, float] = Field(..., description="Probabilities for all scores")


class SHAPOutput(BaseModel):
    predicted_score: int = Field(..., description="Predicted violation score")
    shap_values: Dict[str, float] = Field(..., description="SHAP values for each feature")
    top_features: List[Dict[str, Any]] = Field(..., description="Top contributing features")
    base_value: float = Field(..., description="Base prediction value")


# -----------------------------
# Helpers
# -----------------------------
def _encode_tag(tag: str) -> int:
    if artifacts is None:
        return 0
    le_tag_classes = artifacts["le_tag_classes"]
    if tag in le_tag_classes:
        return le_tag_classes.index(tag)
    return le_tag_classes.index("unknown") if "unknown" in le_tag_classes else 0


def extract_features_from_input(input_data: PredictionInput) -> pd.DataFrame:
    if artifacts is None:
        raise RuntimeError("Artifacts not loaded")

    html = str(input_data.affected_html_elements).lower()
    supp = str(input_data.supplementary_information).lower()
    v_name = str(input_data.violation_name).lower()
    _wcag = str(input_data.wcag_reference).upper()
    _url = str(input_data.web_URL)
    _domain = str(input_data.domain_category).lower().strip()

    tag_match = re.search(r"<([a-zA-Z0-9]+)", html)
    tag = tag_match.group(1) if tag_match else "unknown"

    cr_match = re.search(r"contrastratio':\s*([0-9.]+)", supp)
    fs_match = re.search(r"fontsize':\s*['\"]([0-9.]+)", supp)

    soup = BeautifulSoup(str(supp), "html.parser")

    features = {
        "tag_enc": _encode_tag(tag),
        "snippet_len": len(html),
        "word_count": len(html.split()),
        "tag_count": html.count("<"),
        "is_button_or_link": 1 if any(x in html for x in ["<a", "<button"]) else 0,
        "is_img_or_svg": 1 if any(x in html for x in ["<img", "<svg"]) else 0,
        "has_alt_attr": 1 if "alt=" in html else 0,
        "has_aria_label": 1 if "aria-label=" in html else 0,
        "has_role_attr": 1 if "role=" in html else 0,
        "is_aria_related": 1 if ("aria" in v_name or "aria" in supp) else 0,
        "contrast_ratio": float(cr_match.group(1)) if cr_match else 0.0,
        "font_size": float(fs_match.group(1)) if fs_match else 0.0,
        "num_links": len(soup.find_all("a")),
        "num_images": len(soup.find_all(["img", "svg"])),
        "num_buttons": len(soup.find_all("button")),
        "num_inputs": len(soup.find_all("input")),
        "num_lists": len(soup.find_all(["ul", "ol", "li"])),
        "num_headings": len(soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])),
        "has_form": int(soup.find("form") is not None),
        "num_divs": len(soup.find_all("div")),
        "num_spans": len(soup.find_all("span")),
        "avg_text_len_per_tag": float(np.mean([len(t.get_text()) for t in soup.find_all()])) if soup.find_all() else 0.0,
        "has_inline_style": int(soup.find(attrs={"style": True}) is not None),
        "has_script_or_style": int(soup.find(["script", "style"]) is not None),
    }

    df = pd.DataFrame([features])

    # ensure training features exist and in correct order
    for feat in artifacts["feature_names"]:
        if feat not in df.columns:
            df[feat] = 0

    return df[artifacts["feature_names"]]


def _to_dmatrix(X: pd.DataFrame) -> xgb.DMatrix:
    return xgb.DMatrix(X, feature_names=list(X.columns))


def _slice_multiclass_shap(shap_vals, pred_class: int, n_classes: int) -> np.ndarray:
    """
    SHAP multiclass outputs vary by version:
      - list of length K with arrays (n_samples, n_features)
      - ndarray (n_samples, n_features, K)
      - ndarray (n_samples, K, n_features)
      - ndarray (K, n_samples, n_features)
    Return 1D array (n_features,) for the predicted class.
    """
    if isinstance(shap_vals, list):
        # list[K] -> (n_samples, n_features)
        return np.asarray(shap_vals[pred_class][0]).reshape(-1)

    S = np.asarray(shap_vals)

    if S.ndim != 3:
        raise ValueError(f"Unexpected SHAP ndim={S.ndim}, shape={S.shape}")

    if S.shape[-1] == n_classes:
        # (n_samples, n_features, K)
        return S[0, :, pred_class].reshape(-1)
    if S.shape[1] == n_classes:
        # (n_samples, K, n_features)
        return S[0, pred_class, :].reshape(-1)
    if S.shape[0] == n_classes:
        # (K, n_samples, n_features)
        return S[pred_class, 0, :].reshape(-1)

    raise ValueError(f"3D SHAP array but no axis matches n_classes={n_classes}. shape={S.shape}")


def _get_base_value_for_class(expl: shap.TreeExplainer, pred_class: int) -> float:
    ev = np.asarray(expl.expected_value).reshape(-1)
    if ev.size == 1:
        return float(ev[0])
    return float(ev[pred_class])


# -----------------------------
# Model loading
# -----------------------------
def load_model() -> bool:
    global model, artifacts, explainer

    try:
        # model_path = os.path.join("models", "xgb_model.json")
        # art_path = os.path.join("models", "model_artifacts.pkl")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, "models", "xgb_model.json")
        art_path = os.path.join(script_dir, "models", "model_artifacts.pkl")

        model = xgb.Booster()
        model.load_model(model_path)

        with open(art_path, "rb") as f:
            artifacts = pickle.load(f)

        # Build a tiny background dataset so SHAP init is stable for Booster multiclass
        bg = pd.DataFrame(
            [np.zeros(len(artifacts["feature_names"]))],
            columns=artifacts["feature_names"],
        )

        print("Initializing SHAP explainer...")
        # explainer = shap.TreeExplainer(
        #     model,
        #     data=bg,
        #     feature_perturbation="tree_path_dependent",
        # )

        # Build a larger background dataset so it covers enough leaves
        # (TreeExplainer needs this for multiclass + Booster)
        bg_rows = []
        dummy = PredictionInput(
            affected_html_elements='<img src="x.png" alt="logo">',
            supplementary_information='<div><a href="#">link</a><button>ok</button><img src="x.png"></div>',
            violation_name="missing alt text",
            wcag_reference="WCAG 1.1.1 (A)",
            web_URL="https://example.com",
            domain_category="education",
        )

        # create variation to cover more splits
        for tag in ["img", "a", "button", "input", "div", "svg", "span", "h1"]:
            dummy.affected_html_elements = f'<{tag} aria-label="x" role="x" style="color:#aaa">test</{tag}>'
            dummy.supplementary_information = (
                f"<div><{tag} aria-label='x'>hello</{tag}>"
                f"<a href='#'>a</a><button>btn</button><input type='text'/>"
                f"<ul><li>one</li></ul><h1>H</h1></div>"
                f" contrastratio': {np.random.uniform(1, 21):.2f}, fontsize': '{np.random.uniform(10, 24):.1f}"
            )
            bg_rows.append(extract_features_from_input(dummy))

        bg = pd.concat(bg_rows, ignore_index=True)

        # Use interventional (works when background doesn't cover all leaves)
        explainer = shap.TreeExplainer(
            model,
            data=bg,
            feature_perturbation="interventional"
        )

        print("✅ SHAP explainer initialized successfully!")
        print("✅ Model and artifacts loaded successfully!")
        return True

    except Exception as e:
        print(f"❌ Error loading model/SHAP: {e}")
        import traceback
        traceback.print_exc()
        model = None
        artifacts = None
        explainer = None
        return False


@app.on_event("startup")
async def startup_event():
    ok = load_model()
    if not ok:
        print("⚠️  WARNING: Model/SHAP not loaded. Check models/ paths and versions.")


# -----------------------------
# Endpoints
# -----------------------------
@app.get("/")
async def root():
    return {
        "message": "AccessGuru ML API",
        "status": "running",
        "model_loaded": model is not None,
        "artifacts_loaded": artifacts is not None,
        "explainer_ready": explainer is not None,
        "endpoints": {
            "predict": "/predict",
            "shap": "/shap",
            "predict_with_shap": "/predict-with-shap",
            "health": "/health",
        },
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "artifacts_loaded": artifacts is not None,
        "explainer_ready": explainer is not None,
    }


@app.post("/predict", response_model=PredictionOutput)
async def predict(input_data: PredictionInput):
    if model is None or artifacts is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        X = extract_features_from_input(input_data)
        dm = _to_dmatrix(X)

        probs = model.predict(dm)[0]  # (K,)
        probs = np.asarray(probs).reshape(-1)

        y_pred_class = int(np.argmax(probs))

        reverse_mapping = artifacts["reverse_mapping"]
        predicted_score = reverse_mapping[y_pred_class]

        all_probabilities = {
            reverse_mapping[i]: float(probs[i]) for i in range(len(probs))
        }

        return PredictionOutput(
            predicted_score=int(predicted_score),
            prediction_probability=float(probs[y_pred_class]),
            all_probabilities=all_probabilities,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")


@app.post("/shap", response_model=SHAPOutput)
async def get_shap_values(input_data: PredictionInput):
    if model is None or artifacts is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    if explainer is None:
        raise HTTPException(status_code=503, detail="SHAP explainer not initialized (startup failed)")

    try:
        X = extract_features_from_input(input_data)

        # Predict class (Booster needs DMatrix)
        dm = _to_dmatrix(X)
        probs = np.asarray(model.predict(dm)[0]).reshape(-1)
        y_pred_class = int(np.argmax(probs))

        reverse_mapping = artifacts["reverse_mapping"]
        predicted_score = int(reverse_mapping[y_pred_class])

        # Compute SHAP values
        shap_vals = explainer.shap_values(X)

        # K classes
        n_classes = len(reverse_mapping)  # should be 4
        shap_array = _slice_multiclass_shap(shap_vals, y_pred_class, n_classes)
        base_value = _get_base_value_for_class(explainer, y_pred_class)

        feature_names = artifacts["feature_names"]
        shap_dict = {f: float(v) for f, v in zip(feature_names, shap_array)}

        top_features = sorted(
            [{"feature": k, "shap_value": v} for k, v in shap_dict.items()],
            key=lambda x: abs(x["shap_value"]),
            reverse=True,
        )[:10]

        return SHAPOutput(
            predicted_score=predicted_score,
            shap_values=shap_dict,
            top_features=top_features,
            base_value=float(base_value),
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SHAP calculation error: {str(e)}")


@app.post("/predict-with-shap")
async def predict_with_shap(input_data: PredictionInput):
    if model is None or artifacts is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    if explainer is None:
        raise HTTPException(status_code=503, detail="SHAP explainer not initialized (startup failed)")

    prediction = await predict(input_data)
    shap_output = await get_shap_values(input_data)

    return {
        "prediction": prediction.dict(),
        "explanation": shap_output.dict(),
    }


if __name__ == "__main__":
    import uvicorn

    print("🚀 AccessGuru ML API starting on http://0.0.0.0:8000")
    print("   📚 API docs: http://localhost:8000/docs")
    print("   ❤️  Health check: http://localhost:8000/health")
    uvicorn.run(app, host="0.0.0.0", port=8000)
