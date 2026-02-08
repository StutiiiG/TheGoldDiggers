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