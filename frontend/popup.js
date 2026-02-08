// =====================================================
// AccessGuru Popup (popup.js)
// - Runs axe-core on the active tab
// - Enhances violations via ML API (or static fallback)
// - Computes weighted accessibility score (0–100)
// - NO LLM / ML INSIGHTS (removed completely)
// =====================================================

// ML Models - Static mock data (will be replaced with real ML later)
const MLModels = {
  // Model 1: Semantic Quality Scorer
  scoreAltTextQuality(altText, context) {
    if (!altText) return { score: 0, issues: ['Missing alt text'] };

    const words = altText.trim().split(/\s+/);
    const wordCount = words.length;

    // Simple heuristic scoring (replace with real ML)
    let score = 5.0; // baseline
    const issues = [];
    const suggestions = [];

    // Generic words
    const genericWords = ['image', 'picture', 'photo', 'graphic', 'icon'];
    if (genericWords.some(w => altText.toLowerCase() === w)) {
      score -= 3;
      issues.push('Generic word detected');
      suggestions.push('Describe what the image shows, not just "image"');
    }

    // Too short
    if (wordCount === 1) {
      score -= 2;
      issues.push('Too brief');
      suggestions.push('Add more descriptive details');
    }

    // Good length
    if (wordCount >= 3 && wordCount <= 15) {
      score += 2;
    }

    // Has numbers (potentially good for charts)
    if (/\d/.test(altText)) {
      score += 1;
    }

    // Looks like filename
    if (/\.(jpg|png|gif|jpeg)/i.test(altText)) {
      score -= 3;
      issues.push('Appears to be filename');
      suggestions.push('Replace filename with meaningful description');
    }

    score = Math.max(0, Math.min(10, score));

    return {
      score: parseFloat(score.toFixed(1)),
      issues,
      suggestions,
      confidence: 0.85
    };
  },

  // Model 2: Impact Predictor (static fallback only)
  predictImpact(violation, pageContext) {
    const impactMap = {
      'critical': { percentage: 45, groups: ['Blind users', 'Screen reader users'] },
      'serious': { percentage: 35, groups: ['Low vision users', 'Keyboard-only users'] },
      'moderate': { percentage: 20, groups: ['Color blind users', 'Motor impaired users'] },
      'minor': { percentage: 10, groups: ['Users in bright sunlight', 'Older adults'] }
    };

    const baseImpact = impactMap[violation.impact] || impactMap['moderate'];

    // Adjust based on element type
    let adjustedPercentage = baseImpact.percentage;
    if (violation.description && violation.description.toLowerCase().includes('button')) {
      adjustedPercentage += 10;
    }
    if (violation.description && violation.description.toLowerCase().includes('form')) {
      adjustedPercentage += 15;
    }

    return {
      percentage: Math.min(100, adjustedPercentage),
      affectedGroups: baseImpact.groups,
      confidence: 0.82
    };
  },

  // Model 3: Natural Language Explainer (static fallback only)
  generateExplanation(violation) {
    const templates = {
      'image-alt': {
        what: 'Images are missing descriptive alternative text',
        who: ['Blind users using screen readers', 'Users with images disabled'],
        why: 'Screen readers cannot convey image content without alt text',
        how: ['Add descriptive alt="" attributes to images', 'Describe the purpose and content of the image']
      },
      'color-contrast': {
        what: 'Text does not have sufficient contrast against its background',
        who: ['Low vision users', 'Color blind users', 'Users viewing in bright sunlight'],
        why: 'Insufficient contrast makes text difficult or impossible to read',
        how: ['Increase contrast ratio to at least 4.5:1', 'Use darker text or lighter backgrounds']
      },
      'link-name': {
        what: 'Links lack descriptive text',
        who: ['Screen reader users', 'Keyboard navigation users'],
        why: 'Generic link text like "click here" doesn\'t provide context',
        how: ['Use descriptive link text that explains the destination', 'Avoid generic phrases like "click here" or "read more"']
      }
    };

    // Find matching template
    let template = null;
    for (const [key, value] of Object.entries(templates)) {
      if (violation.id && violation.id.includes(key)) {
        template = value;
        break;
      }
    }

    if (!template) {
      template = {
        what: violation.description,
        who: ['Users with disabilities'],
        why: 'This violates WCAG accessibility guidelines',
        how: ['Review WCAG documentation', 'Fix the reported issue']
      };
    }

    return template;
  },

  _mapImpactToScore(impact) {
    const impactMap = {
      'critical': 5,
      'serious': 4,
      'moderate': 3,
      'minor': 2
    };
    return impactMap[impact] || 3;
  }
};


// =====================================================
// DOM Elements
// =====================================================
const runTestBtn = document.getElementById('runTest');
const runAgainBtn = document.getElementById('runAgain');
const exportReportBtn = document.getElementById('exportReport');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('statusText');
const controlsDiv = document.getElementById('controls');
const resultsDiv = document.getElementById('results');
const errorDiv = document.getElementById('error');
const errorMessage = document.getElementById('errorMessage');

let currentResults = null;
let currentTabId = null;


// =====================================================
// Restore previous results for same URL
// =====================================================
window.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab.url;

  chrome.storage.local.get(['accessGuruResults', 'accessGuruTabId', 'accessGuruUrl'], (data) => {
    if (data.accessGuruResults && data.accessGuruTabId && data.accessGuruUrl === currentUrl) {
      currentResults = data.accessGuruResults;
      currentTabId = data.accessGuruTabId;
      displayResults(currentResults);
      controlsDiv.classList.add('hidden');
      resultsDiv.classList.remove('hidden');
      console.log('✅ Restored previous results for current URL');
    } else if (data.accessGuruUrl && data.accessGuruUrl !== currentUrl) {
      chrome.storage.local.remove(['accessGuruResults', 'accessGuruTabId', 'accessGuruUrl']);
      console.log('🔄 New URL detected - cleared old results');
    }
  });
});


// =====================================================
// Event Listeners
// =====================================================
runTestBtn.addEventListener('click', runAccessibilityTest);

runAgainBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['accessGuruResults', 'accessGuruTabId', 'accessGuruUrl']);
  currentResults = null;
  currentTabId = null;
  resultsDiv.classList.add('hidden');
  controlsDiv.classList.remove('hidden');
});

exportReportBtn.addEventListener('click', exportReport);
openSidebarBtn.addEventListener('click', openSidebar);


// =====================================================
// Weighted Score + Helpers
// =====================================================
function getPredictedSeverityScore(v) {
  const mlScore =
    v.mlAnalysis?.prediction?.predicted_score ??
    v.mlAnalysis?.prediction?.score;

  if (typeof mlScore === "number") return mlScore;
  return mapImpactToScore(v.impact);
}

function getPredictionConfidence(v) {
  const conf =
    v.mlAnalysis?.prediction?.prediction_probability ??
    v.mlAnalysis?.prediction?.confidence;

  if (typeof conf === "number") return Math.max(0, Math.min(1, conf));
  return 0.75;
}

function severityWeight(score2to5) {
  const map = { 2: 2, 3: 5, 4: 10, 5: 18 };
  return map[score2to5] ?? 5;
}

function instanceMultiplier(n) {
  const capped = Math.min(Math.max(n || 1, 1), 20);
  return 1 + (Math.log2(capped) / 3);
}

function confidenceMultiplier(c) {
  return 0.6 + 0.4 * c;
}

function computeAccessibilityScore0to100(enhancedViolations) {
  let totalPenalty = 0;

  for (const v of enhancedViolations) {
    const s = getPredictedSeverityScore(v);
    const c = getPredictionConfidence(v);
    const n = v.nodes?.length || 1;

    const p = severityWeight(s) * instanceMultiplier(n) * confidenceMultiplier(c);
    totalPenalty += p;
  }

  const score = 100 * Math.exp(-totalPenalty / 65);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function estimateUserImpactFromSeverity(v) {
  const s = getPredictedSeverityScore(v);
  return ({ 2: 15, 3: 35, 4: 60, 5: 85 }[s] ?? 35);
}


// =====================================================
// Core Flow
// =====================================================
async function runAccessibilityTest() {
  try {
    controlsDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    statusDiv.classList.remove('hidden');
    statusText.textContent = 'Analyzing page...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    console.log('🔍 Running test on tab:', tab.url);

    statusText.textContent = 'Loading axe-core library...';
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['axe.min.js']
      });
      console.log('✅ axe-core injected successfully');
    } catch (injectError) {
      console.error('❌ Failed to inject axe-core:', injectError);
      throw new Error('Failed to load axe-core library. Make sure axe.min.js is in the extension folder.');
    }

    statusText.textContent = 'Running axe core tests...';
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runAxeTest
    });

    if (!results || !results[0]) throw new Error('No results returned from executeScript');

    const axeResults = results[0].result;

    if (axeResults && axeResults.error) throw new Error(axeResults.error);
    if (!axeResults || !axeResults.violations) throw new Error('Invalid axe results format');

    statusText.textContent = 'Applying ML analysis...';
    const enhancedResults = await enhanceWithML(axeResults);

    currentResults = enhancedResults;

    chrome.storage.local.set({
      'accessGuruResults': enhancedResults,
      'accessGuruTabId': tab.id,
      'accessGuruUrl': tab.url
    });

    displayResults(enhancedResults);

    await activateOverlay();

    statusDiv.classList.add('hidden');
    resultsDiv.classList.remove('hidden');

  } catch (error) {
    console.error('Error running test:', error);
    statusDiv.classList.add('hidden');
    errorDiv.classList.remove('hidden');
    errorMessage.textContent = `Error: ${error.message}`;
  }
}


// Runs in webpage context
function runAxeTest() {
  return new Promise((resolve) => {
    if (typeof axe === 'undefined') {
      resolve({ error: 'axe-core not loaded' });
      return;
    }

    axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
      }
    }).then(results => resolve(results))
      .catch(error => resolve({ error: error.message }));
  });
}


// =====================================================
// Enhance violations with ML + Compute site score (NO INSIGHTS)
// =====================================================
async function enhanceWithML(axeResults) {
  const violations = axeResults.violations || [];

  const apiHealth = await accessGuruAPI.checkHealth();
  const useML = apiHealth.mlApi;

  if (!useML) console.warn('⚠️ ML API not available, using static model');

  const enhancedViolations = await Promise.all(
    violations.map(async (violation) => {
      const enhanced = { ...violation };

      if (useML) {
        try {
          const mlData = await accessGuruAPI.enhanceViolation(
            {
              ...violation,
              html: violation.nodes?.[0]?.html || '',
              target: violation.nodes?.[0]?.target || [],
              pageUrl: axeResults.url
            },
            axeResults.url,
            'general'
          );

          enhanced.mlAnalysis = {
            prediction: mlData.mlEnhanced?.prediction || null,
            explanation: mlData.mlEnhanced?.explanation || null,
            severity: mlData.mlEnhanced?.severity || null,
            shap: mlData.mlEnhanced?.shap || null
          };
        } catch (error) {
          console.error('Error enhancing violation:', error);
          enhanced.mlAnalysis = getStaticMLAnalysis(violation);
        }
      } else {
        enhanced.mlAnalysis = getStaticMLAnalysis(violation);
      }

      return enhanced;
    })
  );

  const totalViolations = violations.length;
  const criticalCount = violations.filter(v => v.impact === 'critical').length;
  const seriousCount = violations.filter(v => v.impact === 'serious').length;
  const moderateCount = violations.filter(v => v.impact === 'moderate').length;

  // ✅ Weighted 0–100 score
  const score = computeAccessibilityScore0to100(enhancedViolations);

  // ✅ Severity-based “impact %”
  const totalImpact = enhancedViolations.reduce((sum, v) => sum + estimateUserImpactFromSeverity(v), 0);
  const avgImpact = totalViolations > 0 ? Math.round(totalImpact / totalViolations) : 0;

  return {
    violations: enhancedViolations,
    score,
    totalViolations,
    criticalCount,
    seriousCount,
    moderateCount,
    avgImpact,
    url: axeResults.url,
    timestamp: new Date().toISOString(),
    usingMLAPI: useML
  };
}


// =====================================================
// Static fallback
// =====================================================
function getStaticMLAnalysis(violation) {
  return {
    prediction: {
      score: MLModels._mapImpactToScore(violation.impact),
      confidence: 0.75,
      originalImpact: violation.impact
    },
    explanation: MLModels.generateExplanation(violation),
    severity: null,
    shap: {
      topFeatures: [],
      reasons: []
    }
  };
}


// =====================================================
// UI Rendering (NO ML INSIGHTS rendering)
// =====================================================
function displayResults(results) {
  document.getElementById('overallScore').textContent = results.score;
  document.getElementById('totalViolations').textContent = results.totalViolations;
  document.getElementById('criticalCount').textContent = results.criticalCount;
  document.getElementById('seriousCount').textContent = results.seriousCount;
  document.getElementById('moderateCount').textContent = results.moderateCount;

  const interpretation =
    results.score >= 80 ? 'Good - Minor issues to address' :
      results.score >= 60 ? 'Fair - Several improvements needed' :
        results.score >= 40 ? 'Poor - Significant accessibility barriers' :
          'Critical - Major accessibility issues';

  document.getElementById('scoreInterpretation').textContent = interpretation;

  // ML Insights removed; if your UI has a section for it, you can hide it here:
  const mlInsightsSection = document.getElementById('mlInsightsSection');
  if (mlInsightsSection) mlInsightsSection.classList.add('hidden');

  const mlInsightsList = document.getElementById('mlInsightsList');
  if (mlInsightsList) mlInsightsList.innerHTML = '';
}


// =====================================================
// Export Report (unchanged)
// =====================================================
async function exportReport() {
  if (!currentResults) return;

  try {
    exportReportBtn.disabled = true;
    exportReportBtn.textContent = 'Generating PDF...';

    const apiHealth = await accessGuruAPI.checkHealth();

    if (!apiHealth.llmApi) {
      console.warn('LLM API not available, exporting as JSON');
      exportAsJSON();
      return;
    }

    const issues = await Promise.all(currentResults.violations.map(async (v) => {
      let fix, severity;

      if (v.mlAnalysis?.explanation) {
        fix = {
          '1_whats_wrong': v.mlAnalysis.explanation.whatsWrong || v.mlAnalysis.explanation.what || v.description,
          '2_who_this_affects': v.mlAnalysis.explanation.whoThisAffects || (v.mlAnalysis.explanation.who || []).join(', ') || 'Users with disabilities',
          '3_why_it_matters': v.mlAnalysis.explanation.whyItMatters || v.mlAnalysis.explanation.why || 'Violates WCAG guidelines',
          '4_what_to_fix': v.mlAnalysis.explanation.whatToFix || v.help,
          '5_how_to_fix': v.mlAnalysis.explanation.howToFix || (v.mlAnalysis.explanation.how || []).join('; ') || 'Review WCAG documentation'
        };
      } else {
        const explanation = await accessGuruAPI.getLLMExplanation({
          ...v,
          html: v.nodes?.[0]?.html || '',
          target: v.nodes?.[0]?.target || [],
          pageUrl: currentResults.url
        });

        fix = {
          '1_whats_wrong': explanation?.whatsWrong || v.description,
          '2_who_this_affects': explanation?.whoThisAffects || 'Users with disabilities',
          '3_why_it_matters': explanation?.whyItMatters || 'Violates WCAG guidelines',
          '4_what_to_fix': explanation?.whatToFix || v.help,
          '5_how_to_fix': explanation?.howToFix || 'Review WCAG documentation'
        };
      }

      if (v.mlAnalysis?.severity) {
        const score = v.mlAnalysis.prediction?.score || v.mlAnalysis.prediction?.predicted_score || mapImpactToScore(v.impact);
        severity = {
          severity_explanation: v.mlAnalysis.severity.explanation || '',
          key_factors: v.mlAnalysis.severity.keyFactors || [],
          confidence_note: v.mlAnalysis.severity.confidenceNote || '',
          predicted_severity: score,
          severity_name: getSeverityName(score),
          severity_description: v.description
        };
      } else {
        const score = mapImpactToScore(v.impact);
        severity = {
          severity_explanation: `Based on axe-core analysis, this is a ${v.impact} severity issue`,
          key_factors: [v.impact],
          confidence_note: 'Based on static analysis',
          predicted_severity: score,
          severity_name: getSeverityName(score),
          severity_description: v.description
        };
      }

      return {
        url: currentResults.url,
        violation_id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        help_url: v.helpUrl,
        target: v.nodes?.[0]?.target?.[0] || '',
        html_snippet: v.nodes?.[0]?.html || '',
        fix,
        severity
      };
    }));

    const success = await accessGuruAPI.generatePDFReport({
      siteName: new URL(currentResults.url).hostname,
      scannedUrl: currentResults.url,
      generatedFor: 'AccessGuru User',
      issues
    });

    if (success) {
      console.log('✅ Report opened in new tab - use Print to PDF to save');
      alert('Report opened in new tab!\n\nClick the "📄 Save as PDF" button or press Ctrl+P (Cmd+P on Mac) to download.');
    } else {
      throw new Error('Report generation failed');
    }

  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate PDF report. Falling back to JSON export.');
    exportAsJSON();
  } finally {
    exportReportBtn.disabled = false;
    exportReportBtn.textContent = '📄 Export Report';
  }
}


function exportAsJSON() {
  const report = {
    summary: {
      url: currentResults.url,
      timestamp: currentResults.timestamp,
      score: currentResults.score,
      totalViolations: currentResults.totalViolations,
      criticalCount: currentResults.criticalCount,
      seriousCount: currentResults.seriousCount,
      avgImpact: currentResults.avgImpact,
      usingMLAPI: currentResults.usingMLAPI
    },
    violations: currentResults.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      instances: v.nodes?.length || 0,
      mlAnalysis: v.mlAnalysis
    }))
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `accessguru-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}


// =====================================================
// Utility Mapping
// =====================================================
function mapImpactToScore(impact) {
  const map = { critical: 5, serious: 4, moderate: 3, minor: 2 };
  return map[impact] || 3;
}

function getSeverityName(score) {
  const names = { 5: 'Critical', 4: 'High', 3: 'Medium', 2: 'Low' };
  return names[score] || 'Medium';
}


// =====================================================
// Overlay
// =====================================================
async function activateOverlay() {
  if (!currentResults || !currentTabId) return;

  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => typeof window.accessGuruHighlight !== 'undefined'
    });

    if (!checkResult[0].result) {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['overlay.js']
      });
    }

    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: (violations) => {
        if (window.accessGuruHighlight) window.accessGuruHighlight(violations);
      },
      args: [currentResults.violations]
    });

  } catch (error) {
    console.error('Error activating overlay:', error);
  }
}


async function openSidebar() {
  if (!currentResults || !currentTabId) {
    alert('Please run an accessibility test first!');
    return;
  }

  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => typeof window.accessGuruOpenSidebar !== 'undefined'
    });

    if (!checkResult[0].result) {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['overlay.js']
      });
    }

    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => {
        if (window.accessGuruOpenSidebar) window.accessGuruOpenSidebar();
      }
    });

    window.close();

  } catch (error) {
    console.error('Error opening sidebar:', error);
  }
}