# AccessLens

**AI-Powered Accessibility Testing Chrome Extension**

AccessLens is an intelligent Chrome extension that combines machine learning and large language models to automatically detect, explain, and help fix web accessibility issues. It uses XGBoost for severity prediction, SHAP for explainability, and GPT-4 for human-readable explanations.

##  Features

- **ML-Powered Severity Prediction** - XGBoost model predicts violation severity (2-5 scale)
- **SHAP Explainability** - Understand why the AI made each prediction
- **LLM-Generated Explanations** - GPT-4 provides clear, actionable guidance
- **Visual Violation Highlighting** - See issues directly on the page
- **Interactive Sidebar** - Explore all violations with detailed insights
- **PDF Report Generation** - Professional reports via browser Print-to-PDF
- **Real-time Analysis** - Instant accessibility scanning

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Popup UI   │  │   Overlay    │  │ API Service  │      │
│  │  (Results)   │  │ (Highlights) │  │              │      │
│  └──────────────┘  └──────────────┘  └──────┬───────┘      │
└────────────────────────────────────────────┼────────────────┘
                                             │
                    ┌────────────────────────┼────────────────┐
                    │                        │                │
         ┌──────────▼─────────┐  ┌──────────▼──────────┐
         │   ML API (8000)    │  │   LLM API (5055)    │
         │  XGBoost + SHAP    │  │  GPT-4 + Reports    │
         └────────────────────┘  └─────────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.8 or higher
- Google Chrome browser

### Installation

**1. Clone the repository**
```bash
git https://github.com/ApurvGude2000/TheGoldDiggers.git
cd TheGoldDiggers
```

**2. Setup backend (One command!)**
```bash
chmod +x setup.sh
./start-setup.sh
```

This script will:
- Create virtual environment
- Install dependencies
- Start both API servers

**3. Install Chrome extension**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `frontend` folder from this project
5. The AccessGuru icon should appear in your toolbar!

### Manual Setup (Alternative)

If you prefer manual setup:

```bash
# 1. Create virtual environment
python -m venv .venv

# 2. Activate it
source .venv/bin/activate  # macOS/Linux
# OR
.venv\Scripts\activate     # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start ML API (Terminal 1)
python backend/app.py

# 5. Start LLM API (Terminal 2)
python backend/llm_reasons.py
```

## Usage

### Testing a Website

1. **Navigate to any website** in Chrome
2. **Click the AccessGuru icon** in your toolbar
3. **Click "Run Accessibility Test"**
4. **Review violations** in the popup
5. **Click "View All Violations"** for detailed sidebar
6. **Hover over "?" icons** on the page to see specific issues
7. **Click "Export Report"** to generate a PDF

### Understanding the Results

**Violation Score (2-5):**
- **5** = Critical - Blocks major user groups
- **4** = Serious - Significant barriers  
- **3** = Moderate - Notable issues
- **2** = Minor - Small improvements

**SHAP Values:**
- Shows which features contributed to the severity prediction
- Helps understand the AI's reasoning

## 🛠️ Tech Stack

**Frontend:**
- Chrome Extension API (Manifest V3)
- Vanilla JavaScript
- Custom accessibility scanning

**ML Backend:**
- FastAPI
- XGBoost (severity prediction)
- SHAP (explainability)
- scikit-learn
- Python 3.8+

**LLM Backend:**
- FastAPI
- OpenAI GPT-4
- Jinja2 (HTML templating)
- Python 3.8+

## System Perfromance 

AccessLens was designed for lightweight, real-time analysis within the browser environment. Performance measurements show the system introduces minimal overhead while providing ML-driven prioritization.

### Model Footprint

- **xgb_model.json:** 1.98 MB  
- **model_artifacts.pkl:** 3.05 KB  
- **Total model size:** ~1.98 MB  

The compact model size enables efficient deployment without significant memory pressure.

### Inference Performance

| Page Type | Violations | Total Time | Per-Violation |
|----------|-----------|-----------|--------------|
| Simple | 3 | 6.86 ms | 2.29 ms |
| Medium | 8 | 19.53 ms | 2.44 ms |
| Heavy | 20 | 63.39 ms | 3.17 ms |

### Extension Scan Latency

- Simple page: ~8 ms  
- Medium page: ~20 ms  
- Heavy page: ~63 ms  

Typical scans complete well under interactive latency thresholds, demonstrating that ML-based accessibility prioritization can be integrated into browser workflows without noticeable user delay.

##  Failure Analysis

While the multiclass violation classifier achieved strong overall performance, the **Semantic violation class exhibited lower recall (0.17)** compared to Syntactic and Layout categories. This behavior is expected because semantic accessibility issues often depend on contextual meaning (e.g., ambiguous link text, misleading labels) that is not fully captured by structural HTML or ARIA features alone.

Error inspection indicates the model performs reliably on deterministic structural violations but struggles when accessibility depends on human-perceived intent rather than explicit markup patterns. In particular, violations involving ambiguous anchor text and context-dependent labeling were the most common sources of false negatives.

Future improvements could incorporate richer textual embeddings, larger DOM context windows, or multimodal signals (e.g., visual layout features) to better capture semantic accessibility failures and improve recall on context-heavy violations.

---

## Feature Ablation Study

To validate the contribution of our multi-level feature design, we conducted an ablation study by systematically removing structural and contextual feature groups while keeping the modeling pipeline fixed.

### Results

| Feature Set | Features | Macro F1 |
|------------|---------|----------|
| Full feature set | 24 | 0.80 |
| – Structural features | 14 | 0.45 |
| – Contextual features | 10 | 0.74 |

### Key Findings

- **Structural features contribution:** +0.35 Macro F1 (largest gain)  
- **Contextual features contribution:** +0.06 Macro F1 (consistent improvement)

Structural features (DOM-level signals such as tag encoding, ARIA attributes, and element types) contribute the largest performance gain, confirming that element-specific signals are critical for detecting accessibility violations. Removing contextual features produces smaller but consistent degradation, validating the multi-level feature design.

### Most Important Features

1. **contrast_ratio (0.37)** — Contextual  
2. **avg_text_len_per_tag (0.06)** — Contextual  
3. **is_aria_related (0.05)** — Structural  

These results validate the importance of combining rule-level, structural, and contextual signals for robust accessibility severity modeling.

---

## Project Structure

```
accessguru/
├── extension/              # Chrome extension
│   ├── manifest.json      # Extension configuration
│   ├── popup.html         # Results popup UI
│   ├── popup.js           # Popup logic
│   ├── popup.css          # Popup styles
│   ├── overlay.js         # Visual highlights & sidebar
│   └── api-service.js     # Backend API integration
│
├── backend/               # API servers
│   ├── app.py             # ML API (XGBoost + SHAP)
│   ├── llm_reasons.py     # LLM API (GPT-4 + Reports)
│   ├── train_model.py     # Model training script
│   ├── models/            # Trained ML models
│   │   ├── xgb_model.json
│   │   └── model_artifacts.pkl
│   └── .env               # Environment variables (you create this)
│
├── demo/                  # Demo materials
│   └── demo-page.html     # Sample page with issues
│
├── requirements.txt       # Python dependencies
├── start-simple.sh        # Quick start script
└── README.md              # This file
```

## Configuration

### Backend APIs

Both APIs run locally by default:
- **ML API**: http://localhost:8000
- **LLM API**: http://localhost:5055

### Environment Variables

Create `backend/.env`:
```bash
# Required
OPENAI_API_KEY=your-openai-api-key

# Optional (defaults shown)
MODEL=gpt-4o-mini
PORT=5055
```

## Testing

### Test Backend APIs

**Health checks:**
```bash
curl http://localhost:8000/health
curl http://localhost:5055/health
```

**Test ML prediction:**
```bash
curl -X POST http://localhost:8000/predict-with-shap \
  -H "Content-Type: application/json" \
  -d '{
    "affected_html_elements": "<img src=\"logo.png\">",
    "supplementary_information": "",
    "violation_name": "image-alt",
    "wcag_reference": "WCAG 1.1.1",
    "web_URL": "https://example.com",
    "domain_category": "general"
  }'
```

### "Model not loaded" error

Train the model:
```bash
source .venv/bin/activate
python backend/train_model.py
```

### "API not available" in extension

1. Check both servers are running
2. Check terminal output for errors
3. Verify ports 8000 and 5055 are not in use:
   ```bash
   lsof -i :8000
   lsof -i :5055
   ```

### Python version issues

Requires Python 3.8+:
```bash
python --version
# or
python3 --version
```

### Port already in use

Kill existing process:
```bash
lsof -i :8000  # Find PID
kill -9 <PID>  # Kill it
```

### Extension not loading

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Check for error messages
4. Click "Reload" on the extension

---

<div align="center">
  <strong>Made with ❤️ for a more accessible web</strong>
</div>
