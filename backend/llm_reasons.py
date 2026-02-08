import os
import json
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openai import OpenAI
from dotenv import load_dotenv
import uvicorn
from fastapi.responses import StreamingResponse, HTMLResponse
from jinja2 import Environment, BaseLoader
import io
from datetime import datetime

load_dotenv()

app = FastAPI(title="AccessGuru LLM Server")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
PORT = int(os.getenv("PORT", "5055"))
MODEL = os.getenv("MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("❌ Missing OPENAI_API_KEY in environment variables")

openai_client = OpenAI(api_key=OPENAI_API_KEY)

# Required JSON keys for response
REQUIRED_KEYS = [
    "1_whats_wrong",
    "2_who_this_affects",
    "3_why_it_matters",
    "4_what_to_fix",
    "5_how_to_fix"
]


# Pydantic models
class ShapReason(BaseModel):
    feature: Optional[str] = None
    direction: Optional[str] = None
    contribution: Optional[float] = None


class ShapValue(BaseModel):
    feature: str
    value: float  # The actual SHAP value (positive = increases severity, negative = decreases)
    feature_value: Optional[Any] = None  # The actual value of the feature in the HTML snippet


class SeverityRequest(BaseModel):
    html_snippet: str
    violation_id: Optional[str] = ""
    predicted_severity: int  # The predicted class: 2, 3, 4, or 5
    severity_probabilities: Dict[str, float]  # e.g., {"2": 0.1, "3": 0.2, "4": 0.5, "5": 0.2}
    shap_values: List[ShapValue]  # SHAP values for the predicted class
    url: Optional[str] = ""
    target: Optional[str] = ""


class FixRequest(BaseModel):
    url: Optional[str] = ""
    violation_id: Optional[str] = ""
    impact: Optional[str] = ""
    help: Optional[str] = ""
    description: Optional[str] = ""
    html_snippet: Optional[str] = ""
    target: Optional[str] = ""
    help_url: Optional[str] = ""
    wcag_tags: Optional[List[str]] = Field(default_factory=list)
    shap_reasons: Optional[List[ShapReason]] = Field(default_factory=list)


class FixResponse(BaseModel):
    whats_wrong: str = Field(..., alias="1_whats_wrong")
    who_this_affects: str = Field(..., alias="2_who_this_affects")
    why_it_matters: str = Field(..., alias="3_why_it_matters")
    what_to_fix: str = Field(..., alias="4_what_to_fix")
    how_to_fix: str = Field(..., alias="5_how_to_fix")

    class Config:
        populate_by_name = True

class IssueFixJson(BaseModel):
    # mirror the output of /api/llm_reasons
    whats_wrong: str = Field(..., alias="1_whats_wrong")
    who_this_affects: str = Field(..., alias="2_who_this_affects")
    why_it_matters: str = Field(..., alias="3_why_it_matters")
    what_to_fix: str = Field(..., alias="4_what_to_fix")
    how_to_fix: str = Field(..., alias="5_how_to_fix")

    class Config:
        populate_by_name = True


class IssueSeverityJson(BaseModel):
    # mirror the output of /api/explain_severity (including the metadata you append)
    severity_explanation: str
    key_factors: List[str]
    confidence_note: str
    predicted_severity: Optional[int] = None
    severity_name: Optional[str] = None
    severity_description: Optional[str] = None


class ReportIssue(BaseModel):
    url: Optional[str] = ""
    violation_id: str
    impact: Optional[str] = ""
    description: Optional[str] = ""
    help: Optional[str] = ""
    help_url: Optional[str] = ""
    target: Optional[str] = ""
    html_snippet: Optional[str] = ""

    fix: IssueFixJson
    severity: IssueSeverityJson


class ReportRequest(BaseModel):
    site_name: Optional[str] = ""
    scanned_url: Optional[str] = ""
    generated_for: Optional[str] = ""
    issues: List[ReportIssue]


# Accessibility rules database (parsed from markdown)
ACCESSIBILITY_RULES = {
    "area-alt": {
        "description": "Ensure <area> elements of image maps have alternative text",
        "impact": "Critical",
        "wcag": ["2.4.4", "4.1.2"],
        "category": "Text Alternatives"
    },
    "aria-allowed-attr": {
        "description": "Ensure an element's role supports its ARIA attributes",
        "impact": "Critical",
        "wcag": ["4.1.2"],
        "category": "ARIA"
    },
    "aria-command-name": {
        "description": "Ensure every ARIA button, link and menuitem has an accessible name",
        "impact": "Serious",
        "wcag": ["4.1.2"],
        "category": "ARIA"
    },
    "aria-hidden-body": {
        "description": "Ensure aria-hidden='true' is not present on the document body",
        "impact": "Critical",
        "wcag": ["1.3.1", "4.1.2"],
        "category": "ARIA"
    },
    "button-name": {
        "description": "Ensure buttons have discernible text",
        "impact": "Critical",
        "wcag": ["4.1.2"],
        "category": "Forms"
    },
    "color-contrast": {
        "description": "Ensure the contrast between foreground and background colors meets WCAG requirements",
        "impact": "Serious",
        "wcag": ["1.4.3"],
        "category": "Color"
    },
    "document-title": {
        "description": "Ensure each HTML document contains a non-empty <title> element",
        "impact": "Serious",
        "wcag": ["2.4.2"],
        "category": "Semantics"
    },
    "duplicate-id-aria": {
        "description": "Ensure every id attribute value used in ARIA and in labels is unique",
        "impact": "Critical",
        "wcag": ["4.1.1"],
        "category": "Parsing"
    },
    "form-field-multiple-labels": {
        "description": "Ensure form field does not have multiple label elements",
        "impact": "Moderate",
        "wcag": ["3.3.2"],
        "category": "Forms"
    },
    "frame-title": {
        "description": "Ensure <iframe> and <frame> elements have a unique and non-empty title attribute",
        "impact": "Serious",
        "wcag": ["4.1.2"],
        "category": "Semantics"
    },
    "html-has-lang": {
        "description": "Ensure every HTML document has a lang attribute",
        "impact": "Serious",
        "wcag": ["3.1.1"],
        "category": "Language"
    },
    "html-lang-valid": {
        "description": "Ensure the lang attribute of the <html> element has a valid value",
        "impact": "Serious",
        "wcag": ["3.1.1"],
        "category": "Language"
    },
    "image-alt": {
        "description": "Ensure <img> elements have alternate text or a role of none or presentation",
        "impact": "Critical",
        "wcag": ["1.1.1"],
        "category": "Text Alternatives"
    },
    "input-button-name": {
        "description": "Ensure input buttons have discernible text",
        "impact": "Critical",
        "wcag": ["4.1.2"],
        "category": "Forms"
    },
    "input-image-alt": {
        "description": "Ensure <input type='image'> elements have alternate text",
        "impact": "Critical",
        "wcag": ["1.1.1", "4.1.2"],
        "category": "Forms"
    },
    "label": {
        "description": "Ensure every form element has a label",
        "impact": "Critical",
        "wcag": ["1.3.1", "4.1.2"],
        "category": "Forms"
    },
    "link-name": {
        "description": "Ensure links have discernible text",
        "impact": "Serious",
        "wcag": ["4.1.2", "2.4.4"],
        "category": "Semantics"
    },
    "list": {
        "description": "Ensure that lists are structured correctly",
        "impact": "Serious",
        "wcag": ["1.3.1"],
        "category": "Semantics"
    },
    "listitem": {
        "description": "Ensure <li> elements are used semantically",
        "impact": "Serious",
        "wcag": ["1.3.1"],
        "category": "Semantics"
    },
    "meta-viewport": {
        "description": "Ensure <meta name='viewport'> does not disable text scaling and zooming",
        "impact": "Critical",
        "wcag": ["1.4.4"],
        "category": "Zoom"
    },
    "heading-order": {
        "description": "Ensure the order of headings is semantically correct",
        "impact": "Moderate",
        "wcag": ["1.3.1"],
        "category": "Semantics"
    },
    "page-has-heading-one": {
        "description": "Ensure the page has at least one <h1>",
        "impact": "Moderate",
        "wcag": ["1.3.1"],
        "category": "Semantics"
    },
    "role-img-alt": {
        "description": "Ensure [role='img'] elements have alternate text",
        "impact": "Serious",
        "wcag": ["1.1.1"],
        "category": "ARIA"
    },
    "scrollable-region-focusable": {
        "description": "Ensure scrollable region has keyboard access",
        "impact": "Serious",
        "wcag": ["2.1.1"],
        "category": "Keyboard"
    },
    "select-name": {
        "description": "Ensure select element has an accessible name",
        "impact": "Critical",
        "wcag": ["4.1.2"],
        "category": "Forms"
    },
    "svg-img-alt": {
        "description": "Ensure <svg> elements with an img role have an alternative text",
        "impact": "Serious",
        "wcag": ["1.1.1"],
        "category": "Text Alternatives"
    },
    "valid-lang": {
        "description": "Ensure lang attributes have valid values",
        "impact": "Serious",
        "wcag": ["3.1.2"],
        "category": "Language"
    },
    "video-caption": {
        "description": "Ensure <video> elements have captions",
        "impact": "Critical",
        "wcag": ["1.2.2"],
        "category": "Media"
    }
}


# Feature descriptions for SHAP interpretation
FEATURE_DESCRIPTIONS = {
    'tag_enc': 'HTML tag type (encoded value representing different element types)',
    'snippet_len': 'Total length of the HTML snippet in characters',
    'word_count': 'Number of words/text content within the element',
    'tag_count': 'Number of nested HTML tags within the element',
    'is_button_or_link': 'Whether element is a button or link (interactive element)',
    'is_img_or_svg': 'Whether element is an image or SVG graphic',
    'has_alt_attr': 'Presence of alt attribute (for images)',
    'has_aria_label': 'Presence of aria-label attribute',
    'has_role_attr': 'Presence of role attribute',
    'is_aria_related': 'Whether element uses ARIA attributes',
    'contrast_ratio': 'Color contrast ratio between text and background',
    'font_size': 'Font size in pixels'
}

# Severity level descriptions
SEVERITY_LEVELS = {
    2: {
        "name": "Minor",
        "description": "Low-impact issues that may cause minor inconvenience",
        "color": "yellow"
    },
    3: {
        "name": "Moderate", 
        "description": "Medium-impact issues that create barriers for some users",
        "color": "orange"
    },
    4: {
        "name": "Serious",
        "description": "High-impact issues that significantly impair accessibility",
        "color": "red"
    },
    5: {
        "name": "Critical",
        "description": "Severe issues that prevent access for many users",
        "color": "darkred"
    }
}


def get_rule_context(violation_id: str) -> str:
    """Get additional context about a specific accessibility rule."""
    rule = ACCESSIBILITY_RULES.get(violation_id, {})
    if not rule:
        return ""
    
    context_parts = [f"Rule: {violation_id}"]
    if rule.get("description"):
        context_parts.append(f"Standard Description: {rule['description']}")
    if rule.get("impact"):
        context_parts.append(f"Impact Level: {rule['impact']}")
    if rule.get("wcag"):
        context_parts.append(f"WCAG Criteria: {', '.join(rule['wcag'])}")
    if rule.get("category"):
        context_parts.append(f"Category: {rule['category']}")
    
    return "\n".join(context_parts)


def build_system_prompt() -> str:
    """Build the system prompt for the LLM."""
    return """You are an accessibility expert assistant for AccessGuru, a Chrome extension that helps developers create more accessible websites.

Your role is to analyze accessibility violations detected by axe-core and provide clear, actionable guidance that helps developers understand and fix issues quickly.

RESPONSE FORMAT:
Return ONLY valid JSON with these exact keys (no additional keys, no markdown, no code blocks):
{
  "1_whats_wrong": "...",
  "2_who_this_affects": "...",
  "3_why_it_matters": "...",
  "4_what_to_fix": "...",
  "5_how_to_fix": "..."
}

WRITING GUIDELINES:
- Each field should be 2-3 concise sentences (maximum 140 characters per field)
- Write in plain language - avoid jargon when possible
- Be specific to the actual HTML snippet and violation context provided
- Focus on actionable solutions, not general theory
- Keep tone professional but approachable

FIELD DEFINITIONS:
1. "1_whats_wrong": Explain the specific accessibility problem in this code
2. "2_who_this_affects": Which users are impacted (screen reader users, keyboard-only users, etc.)
3. "3_why_it_matters": The real-world consequence - what can't users do because of this issue?
4. "4_what_to_fix": Identify the specific element(s) or attribute(s) that need correction
5. "5_how_to_fix": Provide the exact code change or implementation approach

IMPORTANT:
- If the HTML snippet lacks sufficient context, say: "Not enough context from snippet; check help_url for details."
- Reference the actual HTML elements, attributes, and values from the snippet
- When WCAG criteria are provided, briefly mention the relevant guideline
- If ML reasoning is available, consider it but prioritize standard accessibility best practices"""


def build_severity_system_prompt() -> str:
    """Build system prompt for severity explanation."""
    return """You are an AI accessibility expert for AccessGuru. Your role is to explain why a machine learning model assigned a specific severity score to an HTML snippet's accessibility issues.

You will receive:
1. An HTML snippet with accessibility problems
2. A predicted severity level (2=Minor, 3=Moderate, 4=Serious, 5=Critical)
3. SHAP values showing which features most influenced this prediction

RESPONSE FORMAT:
Return ONLY valid JSON with these exact keys:
{
  "severity_explanation": "...",
  "key_factors": ["...", "...", "..."],
  "confidence_note": "..."
}

FIELD DEFINITIONS:
1. "severity_explanation": 2-3 sentences explaining why this severity level was assigned (max 200 chars)
2. "key_factors": Array of 3-5 key factors from SHAP analysis, each explained in plain language (max 100 chars each)
3. "confidence_note": 1-2 sentences about prediction confidence based on probabilities (max 140 chars)

WRITING GUIDELINES:
- Translate technical SHAP values into plain language
- Focus on the top 3-5 most impactful features
- Explain both positive (increases severity) and negative (decreases severity) contributions
- Connect feature values to real accessibility impacts
- Be specific to the HTML snippet provided
- Use approachable, non-technical language
- Don't just list features - explain WHY they matter for accessibility

INTERPRETING SHAP VALUES:
- Positive SHAP value = this feature INCREASES severity
- Negative SHAP value = this feature DECREASES severity  
- Larger absolute value = stronger influence on prediction
- Focus on features with |SHAP| > 0.1 for most meaningful insights"""


def build_user_prompt(payload: FixRequest) -> str:
    """Build the user prompt with violation details."""
    
    # Get rule-specific context
    rule_context = get_rule_context(payload.violation_id)
    
    # Build the complete prompt
    prompt = f"""ACCESSIBILITY VIOLATION ANALYSIS

{rule_context}

VIOLATION DETAILS:
- Page URL: {payload.url}
- Violation ID: {payload.violation_id}
- Impact Severity: {payload.impact}
- Help Text: {payload.help}
- Description: {payload.description}
- Target Selector: {payload.target}
- Help URL: {payload.help_url}
- WCAG Tags: {', '.join(payload.wcag_tags) if payload.wcag_tags else 'None'}

HTML SNIPPET:
```html
{payload.html_snippet or 'No HTML snippet provided'}
```

TASK:
Analyze this specific violation and provide your response as valid JSON following the exact format specified in the system prompt."""
    
    return prompt


def build_severity_user_prompt(payload: SeverityRequest) -> str:
    """Build user prompt for severity explanation."""
    
    # Get severity info
    severity_info = SEVERITY_LEVELS.get(payload.predicted_severity, {})
    severity_name = severity_info.get("name", f"Level {payload.predicted_severity}")
    
    # Sort SHAP values by absolute value (most influential first)
    sorted_shap = sorted(
        payload.shap_values, 
        key=lambda x: abs(x.value), 
        reverse=True
    )
    
    # Format top SHAP values
    shap_explanations = []
    for shap in sorted_shap[:8]:  # Top 8 features
        feature = shap.feature
        value = shap.value
        feature_val = shap.feature_value
        
        desc = FEATURE_DESCRIPTIONS.get(feature, feature)
        direction = "increases" if value > 0 else "decreases"
        impact = "positive" if value < 0 else "negative"  # negative SHAP = good for accessibility
        
        feature_info = f"- {feature} = {feature_val}"
        shap_info = f"  SHAP: {value:.3f} ({direction} severity)"
        explanation = f"  Description: {desc}"
        
        shap_explanations.append(f"{feature_info}\n{shap_info}\n{explanation}")
    
    shap_text = "\n\n".join(shap_explanations)
    
    # Format probabilities
    prob_text = "\n".join([
        f"  - Severity {level}: {prob*100:.1f}%"
        for level, prob in sorted(payload.severity_probabilities.items())
    ])
    
    # Get rule context if available
    rule_context = ""
    if payload.violation_id:
        rule_context = f"\nVIOLATION TYPE:\n{get_rule_context(payload.violation_id)}\n"
    
    prompt = f"""ACCESSIBILITY SEVERITY PREDICTION ANALYSIS

{rule_context}
HTML SNIPPET:
```html
{payload.html_snippet}
```

PREDICTED SEVERITY: {payload.predicted_severity} ({severity_name})
{severity_info.get('description', '')}

PREDICTION PROBABILITIES:
{prob_text}

TOP INFLUENTIAL FEATURES (SHAP Values):
{shap_text}

CONTEXT:
- Page URL: {payload.url or 'Not provided'}
- Target Element: {payload.target or 'Not provided'}

TASK:
Analyze why the ML model predicted severity level {payload.predicted_severity} for this HTML snippet.
Explain in plain language which features most influenced this prediction and why.
Focus on the top 3-5 most impactful factors from the SHAP analysis.

Remember:
- Positive SHAP values INCREASE severity (bad for accessibility)
- Negative SHAP values DECREASE severity (good for accessibility)
- Explain what these values mean in practical accessibility terms"""
    
    return prompt


def validate_response(obj: Dict[str, Any]) -> Optional[str]:
    """Validate the LLM response structure."""
    if not obj or not isinstance(obj, dict):
        return "Response is not a valid object."
    
    keys = list(obj.keys())
    
    # Check for missing required keys
    missing = [k for k in REQUIRED_KEYS if k not in obj]
    if missing:
        return f"Missing required keys: {', '.join(missing)}"
    
    # Check for extra keys
    extra = [k for k in keys if k not in REQUIRED_KEYS]
    if extra:
        return f"Extra keys not allowed: {', '.join(extra)}"
    
    # Validate each value
    for key in REQUIRED_KEYS:
        value = obj[key]
        if not isinstance(value, str):
            return f"Value for '{key}' must be a string, got {type(value).__name__}"
        if len(value) > 140:
            return f"Value for '{key}' exceeds 140 characters ({len(value)} chars)"
        if "\n" in value:
            return f"Value for '{key}' must be single-line (no newlines allowed)"
        if not value.strip():
            return f"Value for '{key}' cannot be empty"
    
    return None


def validate_severity_response(obj: Dict[str, Any]) -> Optional[str]:
    """Validate severity explanation response structure."""
    required_keys = ["severity_explanation", "key_factors", "confidence_note"]
    
    if not obj or not isinstance(obj, dict):
        return "Response is not a valid object."
    
    keys = list(obj.keys())
    
    # Check for missing required keys
    missing = [k for k in required_keys if k not in obj]
    if missing:
        return f"Missing required keys: {', '.join(missing)}"
    
    # Check for extra keys
    extra = [k for k in keys if k not in required_keys]
    if extra:
        return f"Extra keys not allowed: {', '.join(extra)}"
    
    # Validate severity_explanation
    if not isinstance(obj["severity_explanation"], str):
        return "severity_explanation must be a string"
    if len(obj["severity_explanation"]) > 200:
        return f"severity_explanation too long ({len(obj['severity_explanation'])} chars, max 200)"
    if not obj["severity_explanation"].strip():
        return "severity_explanation cannot be empty"
    
    # Validate key_factors
    if not isinstance(obj["key_factors"], list):
        return "key_factors must be an array"
    if len(obj["key_factors"]) < 3 or len(obj["key_factors"]) > 5:
        return f"key_factors must have 3-5 items, got {len(obj['key_factors'])}"
    for i, factor in enumerate(obj["key_factors"]):
        if not isinstance(factor, str):
            return f"key_factors[{i}] must be a string"
        if len(factor) > 100:
            return f"key_factors[{i}] too long ({len(factor)} chars, max 100)"
        if not factor.strip():
            return f"key_factors[{i}] cannot be empty"
    
    # Validate confidence_note
    if not isinstance(obj["confidence_note"], str):
        return "confidence_note must be a string"
    if len(obj["confidence_note"]) > 140:
        return f"confidence_note too long ({len(obj['confidence_note'])} chars, max 140)"
    if not obj["confidence_note"].strip():
        return "confidence_note cannot be empty"
    
    return None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"ok": True, "model": MODEL}


@app.post("/api/llm_reasons", response_model=None)
async def fix_violation(request: Request):
    """
    Analyze an accessibility violation and provide fix guidance.
    
    Returns a JSON object with 5 fields explaining the issue and solution.
    """
    try:
        # Parse request body
        body = await request.json()
        payload = FixRequest(**body)
        
        # Call OpenAI API
        response = openai_client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": build_system_prompt()},
                {"role": "user", "content": build_user_prompt(payload)}
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=800
        )
        
        # Extract response text
        text_output = response.choices[0].message.content
        
        # Parse JSON
        try:
            parsed = json.loads(text_output)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Model returned invalid JSON",
                    "raw_output": text_output,
                    "parse_error": str(e)
                }
            )
        
        # Validate response structure
        validation_error = validate_response(parsed)
        if validation_error:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Invalid JSON schema from model",
                    "validation_error": validation_error,
                    "raw_output": parsed
                }
            )
        
        return parsed
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ /api/fix error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "LLM request failed",
                "detail": str(e)
            }
        )


@app.post("/api/explain_severity", response_model=None)
async def explain_severity(request: Request):
    """
    Explain why ML model assigned a specific severity score based on SHAP values.
    
    Returns explanation of severity prediction with key contributing factors.
    """
    try:
        # Parse request body
        body = await request.json()
        payload = SeverityRequest(**body)
        
        # Validate severity level
        if payload.predicted_severity not in [2, 3, 4, 5]:
            raise HTTPException(
                status_code=400,
                detail={"error": "predicted_severity must be 2, 3, 4, or 5"}
            )
        
        # Call OpenAI API
        response = openai_client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": build_severity_system_prompt()},
                {"role": "user", "content": build_severity_user_prompt(payload)}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=600
        )
        
        # Extract response text
        text_output = response.choices[0].message.content
        
        # Parse JSON
        try:
            parsed = json.loads(text_output)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Model returned invalid JSON",
                    "raw_output": text_output,
                    "parse_error": str(e)
                }
            )
        
        # Validate response structure
        validation_error = validate_severity_response(parsed)
        if validation_error:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Invalid JSON schema from model",
                    "validation_error": validation_error,
                    "raw_output": parsed
                }
            )
        
        # Add metadata to response
        severity_info = SEVERITY_LEVELS.get(payload.predicted_severity, {})
        parsed["predicted_severity"] = payload.predicted_severity
        parsed["severity_name"] = severity_info.get("name", f"Level {payload.predicted_severity}")
        parsed["severity_description"] = severity_info.get("description", "")
        
        return parsed
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ /api/explain_severity error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "LLM request failed",
                "detail": str(e)
            }
        )





def build_report_system_prompt() -> str:
    return """You are an accessibility audit report writer.

Write a comprehensive accessibility report based on a list of detected issues.
Be detailed, structured, and action-oriented.

RETURN ONLY valid JSON (no markdown, no extra keys).

Required JSON structure:
{
  "title": "...",
  "executive_summary": "...",
  "overall_risk": "Low|Medium|High|Critical",
  "highlights": ["...", "...", "..."],
  "stats": {
    "total_issues": 0,
    "by_severity": {"2": 0, "3": 0, "4": 0, "5": 0}
  },
  "prioritized_recommendations": [
    {"priority": "P0|P1|P2", "recommendation": "...", "rationale": "..."}
  ],
  "issue_sections": [
    {
      "violation_id": "...",
      "severity_level": 0,
      "severity_name": "...",
      "summary": "...",
      "impact_on_users": "...",
      "recommended_fix": "...",
      "developer_notes": "..."
    }
  ],
  "next_steps": ["...", "..."]
}

Guidelines:
- Use the provided per-issue fix text and severity explanations.
- Prioritize P0 for severity 5/4, P1 for 3, P2 for 2 unless context suggests otherwise.
- Be specific and practical for developers.
- Keep executive_summary ~6-10 sentences. Other fields can be longer where useful.
"""


def build_report_user_prompt(payload: ReportRequest) -> str:
    # Keep input compact but informative.
    # You can also omit html_snippet if you want to reduce tokens.
    issues_compact = []
    for i in payload.issues:
        issues_compact.append({
            "violation_id": i.violation_id,
            "impact": i.impact,
            "target": i.target,
            "help_url": i.help_url,
            "description": i.description,
            "fix": {
                "whats_wrong": i.fix.whats_wrong,
                "who_this_affects": i.fix.who_this_affects,
                "why_it_matters": i.fix.why_it_matters,
                "what_to_fix": i.fix.what_to_fix,
                "how_to_fix": i.fix.how_to_fix,
            },
            "severity": {
                "predicted_severity": i.severity.predicted_severity,
                "severity_name": i.severity.severity_name,
                "severity_explanation": i.severity.severity_explanation,
                "key_factors": i.severity.key_factors,
                "confidence_note": i.severity.confidence_note
            }
        })

    return f"""
Generate a professional accessibility report.

Site: {payload.site_name}
Scanned URL: {payload.scanned_url}
Generated For: {payload.generated_for}

Issues (JSON):
{json.dumps(issues_compact, ensure_ascii=False)}
""".strip()

def build_report_system_prompt() -> str:
    return """You are an accessibility audit report writer.

Write a comprehensive accessibility report based on a list of detected issues.
Be detailed, structured, and action-oriented.

RETURN ONLY valid JSON (no markdown, no extra keys).

Required JSON structure:
{
  "title": "...",
  "executive_summary": "...",
  "overall_risk": "Low|Medium|High|Critical",
  "highlights": ["...", "...", "..."],
  "stats": {
    "total_issues": 0,
    "by_severity": {"2": 0, "3": 0, "4": 0, "5": 0}
  },
  "prioritized_recommendations": [
    {"priority": "P0|P1|P2", "recommendation": "...", "rationale": "..."}
  ],
  "issue_sections": [
    {
      "violation_id": "...",
      "severity_level": 0,
      "severity_name": "...",
      "summary": "...",
      "impact_on_users": "...",
      "recommended_fix": "...",
      "developer_notes": "..."
    }
  ],
  "next_steps": ["...", "..."]
}

Guidelines:
- Use the provided per-issue fix text and severity explanations.
- Prioritize P0 for severity 5/4, P1 for 3, P2 for 2 unless context suggests otherwise.
- Be specific and practical for developers.
- Keep executive_summary ~6-10 sentences. Other fields can be longer where useful.
"""


def build_report_user_prompt(payload: ReportRequest) -> str:
    # Keep input compact but informative.
    # You can also omit html_snippet if you want to reduce tokens.
    issues_compact = []
    for i in payload.issues:
        issues_compact.append({
            "violation_id": i.violation_id,
            "impact": i.impact,
            "target": i.target,
            "help_url": i.help_url,
            "description": i.description,
            "fix": {
                "whats_wrong": i.fix.whats_wrong,
                "who_this_affects": i.fix.who_this_affects,
                "why_it_matters": i.fix.why_it_matters,
                "what_to_fix": i.fix.what_to_fix,
                "how_to_fix": i.fix.how_to_fix,
            },
            "severity": {
                "predicted_severity": i.severity.predicted_severity,
                "severity_name": i.severity.severity_name,
                "severity_explanation": i.severity.severity_explanation,
                "key_factors": i.severity.key_factors,
                "confidence_note": i.severity.confidence_note
            }
        })

    return f"""
Generate a professional accessibility report.

Site: {payload.site_name}
Scanned URL: {payload.scanned_url}
Generated For: {payload.generated_for}

Issues (JSON):
{json.dumps(issues_compact, ensure_ascii=False)}
""".strip()

REPORT_TEMPLATE = """
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #111; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .meta { color: #444; font-size: 12px; margin-bottom: 16px; }
    .badge { display:inline-block; padding: 2px 8px; border-radius: 10px; font-size:12px; color:#fff; }
    .Critical { background:#7a0019; }
    .High, .Serious { background:#b00020; }
    .Medium, .Moderate { background:#c77700; }
    .Low, .Minor { background:#7a6a00; }
    .card { border:1px solid #ddd; padding:12px; margin: 12px 0; border-radius: 8px; }
    .small { font-size: 12px; color:#444; }
    ul { margin-top: 6px; }
    .section-title { margin-top: 18px; }
    .hr { height:1px; background:#eee; margin: 16px 0; }
  </style>
</head>
<body>
  <h1>{{ report.title }}</h1>
  <div class="meta">
    Generated: {{ generated_at }}<br>
    Site: {{ site_name }} | URL: {{ scanned_url }} | For: {{ generated_for }}
  </div>

  <div class="card">
    <div>
      Overall risk:
      <span class="badge {{ report.overall_risk }}">{{ report.overall_risk }}</span>
    </div>
    <div class="hr"></div>
    <h3>Executive Summary</h3>
    <p>{{ report.executive_summary }}</p>
  </div>

  <div class="card">
    <h3>Highlights</h3>
    <ul>
      {% for h in report.highlights %}
        <li>{{ h }}</li>
      {% endfor %}
    </ul>

    <h3 class="section-title">Stats</h3>
    <div class="small">Total issues: {{ report.stats.total_issues }}</div>
    <div class="small">By severity: 2={{ report.stats.by_severity["2"] }}, 3={{ report.stats.by_severity["3"] }}, 4={{ report.stats.by_severity["4"] }}, 5={{ report.stats.by_severity["5"] }}</div>
  </div>

  <div class="card">
    <h3>Prioritized Recommendations</h3>
    <ul>
      {% for r in report.prioritized_recommendations %}
        <li><strong>{{ r.priority }}</strong>: {{ r.recommendation }}<br><span class="small">{{ r.rationale }}</span></li>
      {% endfor %}
    </ul>
  </div>

  <h2>Findings</h2>
  {% for s in report.issue_sections %}
    <div class="card">
      <div class="small">
        <strong>{{ s.violation_id }}</strong> |
        Severity {{ s.severity_level }} ({{ s.severity_name }})
      </div>
      <p><strong>Summary:</strong> {{ s.summary }}</p>
      <p><strong>Impact on users:</strong> {{ s.impact_on_users }}</p>
      <p><strong>Recommended fix:</strong> {{ s.recommended_fix }}</p>
      <p class="small"><strong>Developer notes:</strong> {{ s.developer_notes }}</p>
    </div>
  {% endfor %}

  <div class="card">
    <h3>Next Steps</h3>
    <ul>
      {% for n in report.next_steps %}
        <li>{{ n }}</li>
      {% endfor %}
    </ul>
  </div>
</body>
</html>
"""

@app.post("/api/generate_report_html", response_class=HTMLResponse)
async def generate_html_report(request: Request):
    """
    Generate HTML report that user can save as PDF using browser's Print to PDF.
    Much simpler than WeasyPrint - no extra dependencies needed!
    """
    try:
        body = await request.json()
        payload = ReportRequest(**body)

        # Build styled HTML report
        html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Accessibility Report - {payload.site_name or 'Website'}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 900px;
            margin: 40px auto;
            padding: 20px;
        }}
        h1 {{ color: #1e293b; margin-bottom: 10px; }}
        .meta {{ color: #666; font-size: 14px; margin-bottom: 30px; }}
        .summary {{
            background: #f8fafc;
            border-left: 4px solid #3b82f6;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
        }}
        .issue {{
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            break-inside: avoid;
        }}
        .critical {{ border-left: 4px solid #dc2626; }}
        .serious {{ border-left: 4px solid #ea580c; }}
        .moderate {{ border-left: 4px solid #f59e0b; }}
        .minor {{ border-left: 4px solid #84cc16; }}
        .badge {{
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            color: white;
        }}
        .badge-critical {{ background: #dc2626; }}
        .badge-serious {{ background: #ea580c; }}
        .badge-moderate {{ background: #f59e0b; }}
        .badge-minor {{ background: #84cc16; }}
        .section {{ margin: 15px 0; }}
        .section-title {{ font-weight: 600; color: #1e293b; margin-bottom: 8px; }}
        .code {{ 
            background: #f1f5f9; 
            padding: 2px 6px; 
            border-radius: 3px; 
            font-family: monospace;
            font-size: 13px;
        }}
        @media print {{
            body {{ margin: 0; padding: 20px; }}
            .issue {{ page-break-inside: avoid; }}
            .print-button {{ display: none; }}
        }}
        .print-button {{
            position: fixed;
            top: 20px;
            right: 20px;
            background: #3b82f6;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
        }}
        .print-button:hover {{ background: #2563eb; }}
    </style>
</head>
<body>
    <button class="print-button" onclick="window.print()">📄 Save as PDF</button>
    
    <h1>Accessibility Report</h1>
    <div class="meta">
        Generated: {datetime.now().strftime("%Y-%m-%d %H:%M UTC")}<br>
        Site: {payload.site_name or 'N/A'}<br>
        URL: {payload.scanned_url or 'N/A'}<br>
        For: {payload.generated_for or 'N/A'}
    </div>

    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Total Issues:</strong> {len(payload.issues)}</p>
        <p>
            Critical: {sum(1 for i in payload.issues if i.impact == 'critical')} | 
            Serious: {sum(1 for i in payload.issues if i.impact == 'serious')} | 
            Moderate: {sum(1 for i in payload.issues if i.impact == 'moderate')} | 
            Minor: {sum(1 for i in payload.issues if i.impact == 'minor')}
        </p>
    </div>

    <h2>Issues Found</h2>
"""

        # Add each issue
        for idx, issue in enumerate(payload.issues, 1):
            severity_class = issue.impact or 'moderate'
            
            html += f"""
    <div class="issue {severity_class}">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
            <h3 style="margin: 0;">#{idx}: {issue.violation_id}</h3>
            <span class="badge badge-{severity_class}">{issue.impact.upper() if issue.impact else 'UNKNOWN'}</span>
        </div>
        
        <div class="section">
            <div class="section-title">What's wrong:</div>
            <p>{issue.fix.whats_wrong}</p>
        </div>

        <div class="section">
            <div class="section-title">Who this affects:</div>
            <p>{issue.fix.who_this_affects}</p>
        </div>

        <div class="section">
            <div class="section-title">Why it matters:</div>
            <p>{issue.fix.why_it_matters}</p>
        </div>

        <div class="section">
            <div class="section-title">How to fix:</div>
            <p>{issue.fix.how_to_fix}</p>
        </div>
"""

            # Add severity explanation if available
            if issue.severity:
                html += f"""
        <div class="section" style="background: #fef3c7; padding: 12px; border-radius: 4px;">
            <div class="section-title">🧠 ML Severity Analysis:</div>
            <p>{issue.severity.severity_explanation}</p>
            <p style="font-size: 13px; color: #666;">
                Predicted: {issue.severity.predicted_severity}/5 | {issue.severity.confidence_note}
            </p>
        </div>
"""

            # Add target info
            if issue.target:
                html += f"""
        <div class="section">
            <div class="section-title">Location:</div>
            <code class="code">{issue.target}</code>
        </div>
"""

            html += """
    </div>
"""

        # Close HTML
        html += """
    <div class="meta" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
        Generated by <strong>AccessGuru</strong> | Powered by AI
    </div>

    <script>
        // Auto-focus print button on page load
        document.querySelector('.print-button').focus();
    </script>
</body>
</html>
"""

        return HTMLResponse(content=html)

    except Exception as e:
        print(f"❌ HTML report generation error: {e}")
        raise HTTPException(status_code=500, detail={"error": "Report generation failed", "detail": str(e)})


@app.post("/api/generate_report", response_model=None)
async def generate_accessibility_report_pdf(request: Request):
    try:
        body = await request.json()
        payload = ReportRequest(**body)

        # 1) LLM creates the report JSON
        llm_resp = openai_client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": build_report_system_prompt()},
                {"role": "user", "content": build_report_user_prompt(payload)},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=2000
        )

        text_output = llm_resp.choices[0].message.content
        try:
            report_obj = json.loads(text_output)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=500,
                detail={"error": "Model returned invalid JSON", "raw_output": text_output, "parse_error": str(e)}
            )

        env = Environment(loader=BaseLoader(), autoescape=True)
        template = env.from_string(REPORT_TEMPLATE)
        html_str = template.render(
            report=report_obj,
            generated_at=datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC"),
            site_name=payload.site_name or "",
            scanned_url=payload.scanned_url or "",
            generated_for=payload.generated_for or ""
        )

        pdf_bytes = HTML(string=html_str).write_pdf()

        filename = "accessibility-report.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ /api/generate_accessibility_report_pdf error: {e}")
        raise HTTPException(status_code=500, detail={"error": "Report generation failed", "detail": str(e)})



if __name__ == "__main__":
    print(f"🚀 AccessGuru LLM server starting on http://localhost:{PORT}")
    print(f"   Model: {MODEL}")
    print(f"   Health check: http://localhost:{PORT}/health")
    uvicorn.run(app, host="0.0.0.0", port=PORT)