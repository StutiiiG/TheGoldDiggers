// api-service.js - Integration with ML backends

const API_CONFIG = {
  ML_API_URL: 'http://localhost:8000',  // XGBoost model API (app-2.py)
  LLM_API_URL: 'http://localhost:5055', // LLM reasons API (llm_reasons.py)
};

class AccessGuruAPI {
  
  /**
   * Get ML prediction and SHAP values for a violation
   */
  async getPredictionWithShap(violation, url, domainCategory) {
    try {
      const payload = {
        affected_html_elements: violation.html || '',
        supplementary_information: this._buildSupplementaryInfo(violation),
        violation_name: violation.id || '',
        wcag_reference: this._extractWCAG(violation),
        web_URL: url || '',
        domain_category: domainCategory || 'general'
      };

      const response = await fetch(`${API_CONFIG.ML_API_URL}/predict-with-shap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`ML API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        predictedScore: data.prediction.predicted_score,
        confidence: data.prediction.prediction_probability,
        allProbabilities: data.prediction.all_probabilities,
        shapValues: data.explanation.shap_values,
        topFeatures: data.explanation.top_features,
        baseValue: data.explanation.base_value
      };
    } catch (error) {
      console.error('Error getting ML prediction:', error);
      return null;
    }
  }

  /**
   * Get LLM-generated explanation for a violation
   */
  async getLLMExplanation(violation, shapReasons = []) {
    try {
      const payload = {
        url: violation.pageUrl || '',
        violation_id: violation.id || '',
        impact: violation.impact || '',
        help: violation.help || '',
        description: violation.description || '',
        html_snippet: violation.html || '',
        target: violation.target?.[0] || '',
        help_url: violation.helpUrl || '',
        wcag_tags: violation.tags || [],
        shap_reasons: shapReasons
      };

      const response = await fetch(`${API_CONFIG.LLM_API_URL}/api/llm_reasons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        whatsWrong: data['1_whats_wrong'],
        whoThisAffects: data['2_who_this_affects'],
        whyItMatters: data['3_why_it_matters'],
        whatToFix: data['4_what_to_fix'],
        howToFix: data['5_how_to_fix']
      };
    } catch (error) {
      console.error('Error getting LLM explanation:', error);
      return null;
    }
  }

  /**
   * Get severity explanation from LLM with SHAP values
   */
  async getSeverityExplanation(violation, mlPrediction) {
    try {
      // Convert SHAP values to required format
      const shapValues = mlPrediction.topFeatures.map(f => ({
        feature: f.feature,
        value: f.shap_value,
        feature_value: null
      }));

      const payload = {
        html_snippet: violation.html || '',
        violation_id: violation.id || '',
        predicted_severity: mlPrediction.predictedScore,
        severity_probabilities: this._formatProbabilities(mlPrediction.allProbabilities),
        shap_values: shapValues,
        url: violation.pageUrl || '',
        target: violation.target?.[0] || ''
      };

      const response = await fetch(`${API_CONFIG.LLM_API_URL}/api/explain_severity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Severity API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        explanation: data.severity_explanation,
        keyFactors: data.key_factors,
        confidenceNote: data.confidence_note
      };
    } catch (error) {
      console.error('Error getting severity explanation:', error);
      return null;
    }
  }

  /**
   * Generate HTML report (opens in new tab, user saves as PDF via browser)
   */
  async generatePDFReport(reportData) {
    try {
      const payload = {
        site_name: reportData.siteName || '',
        scanned_url: reportData.scannedUrl || '',
        generated_for: reportData.generatedFor || 'AccessGuru User',
        issues: reportData.issues || []
      };

      const response = await fetch(`${API_CONFIG.LLM_API_URL}/api/generate_report_html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Report API error: ${response.status}`);
      }

      // Get HTML and open in new tab
      const html = await response.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      // Open in new window - user can Print to PDF from there
      window.open(url, '_blank');
      
      return true;
    } catch (error) {
      console.error('Error generating report:', error);
      return null;
    }
  }

  /**
   * Process a violation with full ML+LLM enhancement
   */
  async enhanceViolation(violation, url, domainCategory) {
    try {
      console.log('🔮 Enhancing violation with ML+LLM:', violation.id);

      // Step 1: Get ML prediction and SHAP values
      const mlPrediction = await this.getPredictionWithShap(violation, url, domainCategory);
      
      if (!mlPrediction) {
        console.warn('⚠️ ML prediction failed, using fallback');
        return this._createFallbackEnhancement(violation);
      }

      // Step 2: Convert SHAP to human-readable reasons
      const shapReasons = this._convertShapToReasons(mlPrediction.topFeatures);

      // Step 3: Get LLM explanation
      const llmExplanation = await this.getLLMExplanation(violation, shapReasons);

      // Step 4: Get severity explanation
      const severityExplanation = await this.getSeverityExplanation(violation, mlPrediction);

      // Combine everything
      return {
        ...violation,
        mlEnhanced: {
          prediction: {
            score: mlPrediction.predictedScore,
            confidence: mlPrediction.confidence,
            probabilities: mlPrediction.allProbabilities,
            originalImpact: violation.impact
          },
          shap: {
            values: mlPrediction.shapValues,
            topFeatures: mlPrediction.topFeatures,
            reasons: shapReasons
          },
          explanation: llmExplanation || this._createFallbackExplanation(violation),
          severity: severityExplanation
        }
      };
    } catch (error) {
      console.error('Error enhancing violation:', error);
      return this._createFallbackEnhancement(violation);
    }
  }

  // Helper methods

  _buildSupplementaryInfo(violation) {
    // Build supplementary information from violation data
    let info = violation.html || '';
    
    // Add any additional context
    if (violation.impact) {
      info += ` impact='${violation.impact}'`;
    }
    
    return info;
  }

  _extractWCAG(violation) {
    // Extract WCAG reference from tags or description
    if (violation.tags && violation.tags.length > 0) {
      const wcagTag = violation.tags.find(t => t.includes('wcag'));
      if (wcagTag) return wcagTag.toUpperCase();
    }
    return 'WCAG 2.1';
  }

  _formatProbabilities(probabilities) {
    // Convert {2: 0.1, 3: 0.2} to {"2": "0.10", "3": "0.20"}
    const formatted = {};
    for (const [key, value] of Object.entries(probabilities)) {
      formatted[key.toString()] = value;
    }
    return formatted;
  }

  _convertShapToReasons(topFeatures) {
    // Convert SHAP features to human-readable reasons
    return topFeatures.slice(0, 5).map(f => ({
      feature: this._humanizeFeatureName(f.feature),
      direction: f.shap_value > 0 ? 'increases' : 'decreases',
      contribution: Math.abs(f.shap_value)
    }));
  }

  _humanizeFeatureName(featureName) {
    // Convert technical names to human-readable
    const nameMap = {
      'contrast_ratio': 'Color contrast ratio',
      'has_alt_attr': 'Presence of alt attribute',
      'font_size': 'Font size',
      'tag_enc': 'HTML element type',
      'num_images': 'Number of images',
      'has_aria_label': 'ARIA label present',
      'word_count': 'Text length',
      'is_button_or_link': 'Interactive element type'
    };
    return nameMap[featureName] || featureName.replace(/_/g, ' ');
  }

  _createFallbackEnhancement(violation) {
    return {
      ...violation,
      mlEnhanced: {
        prediction: {
          score: this._mapImpactToScore(violation.impact),
          confidence: 0.5,
          probabilities: {},
          originalImpact: violation.impact
        },
        shap: {
          values: {},
          topFeatures: [],
          reasons: []
        },
        explanation: this._createFallbackExplanation(violation),
        severity: null
      }
    };
  }

  _createFallbackExplanation(violation) {
    return {
      whatsWrong: violation.description || 'Accessibility issue detected',
      whoThisAffects: 'Users with disabilities',
      whyItMatters: 'This violates WCAG accessibility guidelines',
      whatToFix: violation.help || 'Fix the reported issue',
      howToFix: 'Review WCAG documentation for guidance'
    };
  }

  _mapImpactToScore(impact) {
    const impactMap = {
      'critical': 5,
      'serious': 4,
      'moderate': 3,
      'minor': 2
    };
    return impactMap[impact] || 3;
  }

  /**
   * Check if APIs are available
   */
  async checkHealth() {
    const results = {
      mlApi: false,
      llmApi: false
    };

    try {
      const mlResponse = await fetch(`${API_CONFIG.ML_API_URL}/health`);
      results.mlApi = mlResponse.ok;
    } catch (e) {
      console.warn('ML API not available:', e.message);
    }

    try {
      const llmResponse = await fetch(`${API_CONFIG.LLM_API_URL}/health`);
      results.llmApi = llmResponse.ok;
    } catch (e) {
      console.warn('LLM API not available:', e.message);
    }

    return results;
  }
}

// Create singleton instance and make it globally available
const accessGuruAPI = new AccessGuruAPI();

// Ensure it's accessible in Chrome extension context
if (typeof window !== 'undefined') {
  window.accessGuruAPI = accessGuruAPI;
}