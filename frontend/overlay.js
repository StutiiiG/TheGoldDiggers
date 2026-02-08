// overlay.js - Visual overlay system with side panel

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.accessGuruOverlayInjected) {
    console.log('AccessGuru overlay already injected');
    return;
  }
  window.accessGuruOverlayInjected = true;

  // Severity-based color coding
  const SEVERITY_COLORS = {
    critical: {
      border: '#dc2626',
      background: 'rgba(220, 38, 38, 0.1)',
      label: '#dc2626'
    },
    serious: {
      border: '#ea580c',
      background: 'rgba(234, 88, 12, 0.1)',
      label: '#ea580c'
    },
    moderate: {
      border: '#f59e0b',
      background: 'rgba(245, 158, 11, 0.1)',
      label: '#f59e0b'
    },
    minor: {
      border: '#3b82f6',
      background: 'rgba(59, 130, 246, 0.1)',
      label: '#3b82f6'
    }
  };

  // Store all overlay elements for cleanup
  let overlayElements = [];
  let tooltipElement = null;
  let sidePanel = null;
  let currentViolations = [];

  // Create tooltip element (shared across all highlights)
  function createTooltip() {
    if (tooltipElement) return tooltipElement;

    const tooltip = document.createElement('div');
    tooltip.id = 'access-guru-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      background: white;
      border: 2px solid #333;
      border-radius: 8px;
      padding: 16px;
      max-width: 400px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
    `;

    document.body.appendChild(tooltip);
    tooltipElement = tooltip;
    return tooltip;
  }

  // Create side panel (collapsible, Simplify-style)
  function createSidePanel() {
    const existing = document.getElementById('access-guru-side-panel');
    if (existing) {
      sidePanel = existing;
      return sidePanel;
    }
    if (sidePanel) return sidePanel;

    const panel = document.createElement('div');
    panel.id = 'access-guru-side-panel';
    panel.className = 'collapsed';
    panel.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      height: 100vh;
      background: white;
      border-left: 2px solid #333;
      box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 400px;
      transform: translateX(400px);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
    `;

    panel.innerHTML = `
      <div id="access-guru-toggle" style="
        position: absolute;
        left: -40px;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 80px;
        background: white;
        border: 2px solid #333;
        border-right: none;
        border-radius: 8px 0 0 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
        transition: all 0.2s ease;
      ">
        <div style="
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-weight: 700;
          font-size: 12px;
          color: #3b82f6;
          letter-spacing: 1px;
        ">A11Y</div>
      </div>

      <div style="
        padding: 20px;
        border-bottom: 2px solid #e5e7eb;
        background: #f8fafc;
        flex-shrink: 0;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: #1e293b;">AccessGuru</h3>
          <div style="display: flex; gap: 8px;">
            <button id="access-guru-close" style="
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 6px;
              padding: 6px 14px;
              cursor: pointer;
              font-size: 12px;
              font-weight: 600;
              transition: all 0.2s ease;
            " title="Collapse sidebar (highlights remain)">Collapse</button>
          </div>
        </div>
        <div id="access-guru-stats" style="font-size: 13px; color: #666;">
          Loading violations...
        </div>
      </div>

      <div style="
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      ">
        <div id="access-guru-violations-list" style="
          display: flex;
          flex-direction: column;
          gap: 12px;
        ">
          <!-- Violations will be added here -->
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Toggle panel open/close
    const toggle = document.getElementById('access-guru-toggle');
    toggle.addEventListener('click', () => {
      const isCollapsed = panel.classList.contains('collapsed');
      if (isCollapsed) {
        panel.classList.remove('collapsed');
        panel.style.transform = 'translateX(0)';
      } else {
        panel.classList.add('collapsed');
        panel.style.transform = 'translateX(400px)';
      }
    });

    // Hover effect on toggle
    toggle.addEventListener('mouseenter', () => {
      toggle.style.background = '#f8fafc';
      toggle.style.transform = 'translateY(-50%) scale(1.05)';
    });

    toggle.addEventListener('mouseleave', () => {
      toggle.style.background = 'white';
      toggle.style.transform = 'translateY(-50%) scale(1)';
    });

    // Close button handler - collapse instead of remove
    document.getElementById('access-guru-close').addEventListener('click', () => {
      // Just collapse the sidebar, don't remove everything
      panel.classList.add('collapsed');
      panel.style.transform = 'translateX(400px)';
    });

    // Remove All button handler - completely removes overlay
    // document.getElementById('access-guru-remove-all').addEventListener('click', () => {
    //   removeAllOverlays();
    // });

    // Hover effect on close button
    const closeBtn = document.getElementById('access-guru-close');
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = '#2563eb';
      closeBtn.style.transform = 'scale(1.05)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = '#3b82f6';
      closeBtn.style.transform = 'scale(1)';
    });

    // // Hover effect on remove all button
    // const removeBtn = document.getElementById('access-guru-remove-all');
    // removeBtn.addEventListener('mouseenter', () => {
    //   removeBtn.style.background = '#b91c1c';
    //   removeBtn.style.transform = 'scale(1.05)';
    // });
    // removeBtn.addEventListener('mouseleave', () => {
    //   removeBtn.style.background = '#dc2626';
    //   removeBtn.style.transform = 'scale(1)';
    // });
    const removeBtn = document.getElementById('access-guru-remove-all');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => removeAllOverlays());

      // Hover effect on remove all button
      removeBtn.addEventListener('mouseenter', () => {
        removeBtn.style.background = '#b91c1c';
        removeBtn.style.transform = 'scale(1.05)';
      });
      removeBtn.addEventListener('mouseleave', () => {
        removeBtn.style.background = '#dc2626';
        removeBtn.style.transform = 'scale(1)';
      });
    }

    sidePanel = panel;
    return panel;
  }

  // Update side panel stats
  function updateSidePanelStats(violations) {
    const statsDiv = document.getElementById('access-guru-stats');
    if (!statsDiv) return;

    const counts = {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0
    };

    violations.forEach(v => {
      counts[v.impact] = (counts[v.impact] || 0) + (v.nodes?.length || 0);
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    statsDiv.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 6px; color: #1e293b;">${total} violation${total !== 1 ? 's' : ''} highlighted</div>
      ${counts.critical > 0 ? `<div style="color: ${SEVERITY_COLORS.critical.border}; font-size: 12px;">• Critical: ${counts.critical}</div>` : ''}
      ${counts.serious > 0 ? `<div style="color: ${SEVERITY_COLORS.serious.border}; font-size: 12px;">• Serious: ${counts.serious}</div>` : ''}
      ${counts.moderate > 0 ? `<div style="color: ${SEVERITY_COLORS.moderate.border}; font-size: 12px;">• Moderate: ${counts.moderate}</div>` : ''}
      ${counts.minor > 0 ? `<div style="color: ${SEVERITY_COLORS.minor.border}; font-size: 12px;">• Minor: ${counts.minor}</div>` : ''}
    `;
  }

  // Populate violations list in side panel
  function populateViolationsList(violations) {
    const listDiv = document.getElementById('access-guru-violations-list');
    if (!listDiv) {
      console.error('❌ Could not find violations list div');
      return;
    }

    console.log('📋 Populating violations list with', violations.length, 'violations');

    try {
      listDiv.innerHTML = violations.map((violation, idx) => {
        const explanation = violation.mlAnalysis?.explanation || {};
        const impact = violation.mlAnalysis?.impact || {};
        
        return `
      <div style="
        background: white;
        border: 2px solid ${SEVERITY_COLORS[violation.impact].border};
        border-radius: 8px;
        overflow: hidden;
        transition: all 0.2s ease;
      " 
      class="violation-accordion"
      data-violation-index="${idx}">
        
        <!-- Accordion Header -->
        <div style="
          padding: 12px;
          cursor: pointer;
          background: white;
          transition: background 0.2s ease;
        "
        class="violation-accordion-header"
        onmouseenter="this.style.background='#f8fafc';"
        onmouseleave="this.style.background='white';">
          <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 13px; color: #1e293b; margin-bottom: 4px;">${violation.help}</div>
              <div style="font-size: 11px; color: #64748b;">
                ${violation.nodes?.length || 0} instance${violation.nodes?.length !== 1 ? 's' : ''} • Click to expand
              </div>
            </div>
            <div style="
              background: ${SEVERITY_COLORS[violation.impact].border};
              color: white;
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 700;
              text-transform: uppercase;
              white-space: nowrap;
              flex-shrink: 0;
            ">${violation.impact}</div>
          </div>
          <div style="
            text-align: center;
            margin-top: 8px;
            font-size: 18px;
            color: #94a3b8;
            transition: transform 0.2s ease;
          " class="accordion-arrow">▼</div>
        </div>

        <!-- Accordion Body (initially hidden) -->
        <div style="
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        " class="violation-accordion-body">
          <div style="padding: 16px; border-top: 1px solid #e5e7eb; background: #f8fafc;">
            
            <div style="margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: #475569;">What's wrong:</div>
              <div style="color: #64748b; font-size: 12px; line-height: 1.5;">${violation.description || 'No description available'}</div>
            </div>

            ${explanation.who ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: #475569;">Who this affects:</div>
                <div style="color: #64748b; font-size: 11px; line-height: 1.5;">
                  ${explanation.who.map(w => `• ${w}`).join('<br>')}
                </div>
              </div>
            ` : ''}

            ${explanation.why ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: #475569;">Why it matters:</div>
                <div style="color: #64748b; font-size: 12px; line-height: 1.5;">${explanation.why}</div>
              </div>
            ` : ''}

            ${explanation.how ? `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: #059669;">How to fix:</div>
                <div style="color: #64748b; font-size: 11px; line-height: 1.5;">
                  ${explanation.how.map(h => `• ${h}`).join('<br>')}
                </div>
              </div>
            ` : ''}

            ${impact.percentage ? `
              <div style="background: white; padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #e5e7eb;">
                <div style="font-size: 11px; color: #64748b;">
                  <strong style="color: #1e293b;">Estimated Impact:</strong> ${impact.percentage}% of users
                </div>
              </div>
            ` : ''}

            <button style="
              width: 100%;
              padding: 10px;
              background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
            "
            class="scroll-to-violation-btn"
            data-violation-index="${idx}"
            onmouseenter="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(59,130,246,0.3)';"
            onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
              🎯 Scroll to Issue
            </button>

          </div>
        </div>

      </div>
    `}).join('');

      console.log('✅ HTML generated, adding event listeners...');

      // Add click handlers for accordion headers
      document.querySelectorAll('.violation-accordion-header').forEach((header, idx) => {
        header.addEventListener('click', () => {
          const accordion = header.parentElement;
          const body = accordion.querySelector('.violation-accordion-body');
          const arrow = header.querySelector('.accordion-arrow');
          const isExpanded = body.style.maxHeight && body.style.maxHeight !== '0px';

          if (isExpanded) {
            body.style.maxHeight = '0';
            arrow.style.transform = 'rotate(0deg)';
          } else {
            // Close all other accordions
            document.querySelectorAll('.violation-accordion-body').forEach(b => {
              b.style.maxHeight = '0';
            });
            document.querySelectorAll('.accordion-arrow').forEach(a => {
              a.style.transform = 'rotate(0deg)';
            });

            // Open this one
            body.style.maxHeight = body.scrollHeight + 'px';
            arrow.style.transform = 'rotate(180deg)';
          }
        });
      });

      // Add click handlers for scroll buttons
      document.querySelectorAll('.scroll-to-violation-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.violationIndex);
          scrollToViolation(violations[idx]);
        });
      });

      console.log('✅ Violations list populated successfully');
    } catch (error) {
      console.error('❌ Error populating violations list:', error);
      listDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ef4444;">
          <p style="font-weight: 600; margin-bottom: 8px;">Error loading violations</p>
          <p style="font-size: 12px;">${error.message}</p>
        </div>
      `;
    }
  }

  // Scroll to first instance of a violation
  function scrollToViolation(violation) {
    if (!violation.nodes || violation.nodes.length === 0) return;

    try {
      // Get all selectors for this violation
      const selectors = violation.nodes.map(node => node.target?.[0]).filter(Boolean);
      
      if (selectors.length === 0) return;

      // Scroll to first instance
      const firstElement = document.querySelector(selectors[0]);
      if (firstElement) {
        firstElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Flash ALL instances of this violation
      const highlights = document.querySelectorAll('.access-guru-highlight');
      
      highlights.forEach(h => {
        const highlightSelector = h.dataset.selector;
        
        // Check if this highlight is one of the violation instances
        if (selectors.includes(highlightSelector)) {
          // Store original background
          const originalBg = h.style.background;
          const borderColor = h.style.borderColor;
          
          // Flash sequence with longer duration
          h.style.background = borderColor;
          h.style.transform = 'scale(1.05)';
          
          setTimeout(() => {
            h.style.background = originalBg;
          }, 500); // First flash
          
          setTimeout(() => {
            h.style.background = borderColor;
          }, 700);
          
          setTimeout(() => {
            h.style.background = originalBg;
          }, 1200); // Second flash
          
          setTimeout(() => {
            h.style.background = borderColor;
          }, 1400);
          
          setTimeout(() => {
            h.style.background = originalBg;
            h.style.transform = 'scale(1)';
          }, 1900); // Final fade - total 1.9 seconds
        }
      });
    } catch (e) {
      console.warn('Could not scroll to violation:', e);
    }
  }

  // Show tooltip
  function showTooltip(event, violation, nodeInfo) {
    const tooltip = createTooltip();
    
    const explanation = violation.mlAnalysis?.explanation || {};
    const prediction = violation.mlAnalysis?.prediction || {};
    const shap = violation.mlAnalysis?.shap || {};
    const severity = violation.mlAnalysis?.severity || {};
    
    const explanationHtml = `
      <div style="margin-bottom: 12px;">
        <div style="font-weight: 600; font-size: 15px; margin-bottom: 8px; color: ${SEVERITY_COLORS[violation.impact].border};">
          ${violation.help}
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
          <div style="display: inline-block; background: ${SEVERITY_COLORS[violation.impact].border}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
            ${violation.impact}
          </div>
          ${prediction.score ? `
            <div style="display: inline-block; background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              Violation Score: ${prediction.score}/5
            </div>
          ` : ''}
        </div>
      </div>

      <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #dc2626;">What's wrong:</div>
        <div style="color: #666; font-size: 13px;">${explanation.whatsWrong || violation.description}</div>
      </div>

      ${explanation.whoThisAffects || explanation.who ? `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #dc2626;">Who this affects:</div>
          <div style="color: #666; font-size: 13px;">
            ${explanation.whoThisAffects || (explanation.who?.map(w => `• ${w}`).join('<br>') || 'Users with disabilities')}
          </div>
        </div>
      ` : ''}

      ${explanation.whyItMatters || explanation.why ? `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #dc2626;">Why it matters:</div>
          <div style="color: #666; font-size: 13px;">${explanation.whyItMatters || explanation.why || 'This violates WCAG accessibility guidelines'}</div>
        </div>
      ` : ''}

      ${explanation.howToFix || explanation.how ? `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #059669;">How to fix:</div>
          <div style="color: #666; font-size: 13px;">
            ${explanation.howToFix || (explanation.how?.map(h => `• ${h}`).join('<br>') || 'Review WCAG documentation')}
          </div>
        </div>
      ` : ''}

      ${severity?.explanation ? `
        <div style="background: #fef3c7; padding: 10px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid #f59e0b;">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 4px; color: #92400e;">Severity Analysis:</div>
          <div style="font-size: 11px; color: #78350f;">${severity.explanation}</div>
        </div>
      ` : ''}
    `;

    tooltip.innerHTML = explanationHtml;
    tooltip.style.display = 'block';

    // Position tooltip near cursor but keep it on screen
    const x = event.clientX;
    const y = event.clientY;
    const tooltipRect = tooltip.getBoundingClientRect();
    
    let left = x + 15;
    let top = y + 15;

    // Keep tooltip on screen
    if (left + tooltipRect.width > window.innerWidth) {
      left = x - tooltipRect.width - 15;
    }
    if (top + tooltipRect.height > window.innerHeight) {
      top = y - tooltipRect.height - 15;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  // Hide tooltip
  function hideTooltip() {
    if (tooltipElement) {
      tooltipElement.style.display = 'none';
    }
  }

  // Create highlight overlay for a single element
  function createHighlight(element, violation, nodeInfo, isClickable = true) {
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // Get selector for position updates
    const selector = nodeInfo.target?.[0] || '';

    // Create highlight border
    const highlight = document.createElement('div');
    highlight.className = 'access-guru-highlight';
    highlight.dataset.selector = selector;
    highlight.style.cssText = `
      position: absolute;
      left: ${rect.left + scrollX}px;
      top: ${rect.top + scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid ${SEVERITY_COLORS[violation.impact].border};
      background: ${SEVERITY_COLORS[violation.impact].background};
      pointer-events: ${isClickable ? 'auto' : 'none'};
      z-index: 2147483645;
      box-sizing: border-box;
      border-radius: 4px;
      cursor: ${isClickable ? 'pointer' : 'default'};
      transition: all 0.2s ease;
    `;

    // Make highlight clickable to scroll to element
    if (isClickable) {
      highlight.addEventListener('click', () => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        highlight.style.background = SEVERITY_COLORS[violation.impact].border;
        setTimeout(() => {
          highlight.style.background = SEVERITY_COLORS[violation.impact].background;
        }, 300);
      });

      highlight.addEventListener('mouseenter', () => {
        highlight.style.borderWidth = '5px';
        highlight.style.boxShadow = `0 0 0 4px ${SEVERITY_COLORS[violation.impact].border}33`;
      });

      highlight.addEventListener('mouseleave', () => {
        highlight.style.borderWidth = '3px';
        highlight.style.boxShadow = 'none';
      });
    }

    // Create info icon (question mark)
    const infoIcon = document.createElement('div');
    infoIcon.className = 'access-guru-info-icon';
    infoIcon.style.cssText = `
      position: absolute;
      left: ${rect.left + scrollX + rect.width - 8}px;
      top: ${rect.top + scrollY - 12}px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: ${SEVERITY_COLORS[violation.impact].border};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
      cursor: help;
      pointer-events: auto;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      transition: transform 0.2s ease;
    `;
    infoIcon.textContent = '?';

    // Hover effect on info icon
    infoIcon.addEventListener('mouseenter', (e) => {
      infoIcon.style.transform = 'scale(1.2)';
      showTooltip(e, violation, nodeInfo);
    });

    infoIcon.addEventListener('mouseleave', () => {
      infoIcon.style.transform = 'scale(1)';
      hideTooltip();
    });

    // Update tooltip position on mouse move
    infoIcon.addEventListener('mousemove', (e) => {
      if (tooltipElement && tooltipElement.style.display === 'block') {
        const x = e.clientX;
        const y = e.clientY;
        const tooltipRect = tooltipElement.getBoundingClientRect();
        
        let left = x + 15;
        let top = y + 15;

        if (left + tooltipRect.width > window.innerWidth) {
          left = x - tooltipRect.width - 15;
        }
        if (top + tooltipRect.height > window.innerHeight) {
          top = y - tooltipRect.height - 15;
        }

        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
      }
    });

    document.body.appendChild(highlight);
    document.body.appendChild(infoIcon);

    overlayElements.push(highlight, infoIcon);
  }

  // Remove all overlays
  function removeAllOverlays() {
    overlayElements.forEach(el => {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    overlayElements = [];

    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
      tooltipElement = null;
    }

    if (sidePanel && sidePanel.parentNode) {
      sidePanel.parentNode.removeChild(sidePanel);
      sidePanel = null;
    }

    // Reset listener flag
    window.accessGuruListenersAdded = false;
    window.accessGuruOverlayInjected = false;
  }

  // Main function to highlight all violations
  function highlightViolations(violations) {
    console.log('🎨 Highlighting violations:', violations);

    currentViolations = violations;

    // Create side panel
    createSidePanel();
    updateSidePanelStats(violations);
    populateViolationsList(violations);

    let highlightCount = 0;

    violations.forEach(violation => {
      if (!violation.nodes || violation.nodes.length === 0) return;

      violation.nodes.forEach(node => {
        try {
          // Get the actual DOM element
          const target = node.target || [];
          if (target.length === 0) return;

          // Use the first selector to find the element
          const selector = target[0];
          const element = document.querySelector(selector);

          if (element && element.getBoundingClientRect) {
            createHighlight(element, violation, node);
            highlightCount++;
          }
        } catch (e) {
          console.warn('Could not highlight element:', e);
        }
      });
    });

    console.log(`✅ Created ${highlightCount} highlights`);
  }

  // Update highlight positions without re-rendering
  function updateHighlightPositions() {
    const highlights = document.querySelectorAll('.access-guru-highlight');
    const icons = document.querySelectorAll('.access-guru-info-icon');
    
    highlights.forEach((highlight, index) => {
      const target = highlight.dataset.selector;
      if (!target) return;
      
      try {
        const element = document.querySelector(target);
        if (element) {
          const rect = element.getBoundingClientRect();
          const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
          const scrollY = window.pageYOffset || document.documentElement.scrollTop;
          
          highlight.style.left = `${rect.left + scrollX}px`;
          highlight.style.top = `${rect.top + scrollY}px`;
          highlight.style.width = `${rect.width}px`;
          highlight.style.height = `${rect.height}px`;
          
          // Update icon position
          if (icons[index]) {
            icons[index].style.left = `${rect.left + scrollX + rect.width - 8}px`;
            icons[index].style.top = `${rect.top + scrollY - 12}px`;
          }
        }
      } catch (e) {
        // Element no longer exists
      }
    });
  }

  // Handle window resize
  let resizeTimeout;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      updateHighlightPositions();
    }, 100);
  };
  
  // Handle scroll
  let scrollTimeout;
  const handleScroll = () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      updateHighlightPositions();
    }, 50);
  };

  // Main function to highlight all violations
  function highlightViolations(violations) {
    console.log('🎨 Highlighting violations:', violations);
    
    if (!violations || violations.length === 0) {
      console.warn('⚠️ No violations to highlight');
      return;
    }

    currentViolations = violations;

    try {
      // Create side panel
      console.log('📋 Creating side panel...');
      createSidePanel();
      
      console.log('📊 Updating stats...');
      updateSidePanelStats(violations);
      
      console.log('📝 Populating violations list...');
      populateViolationsList(violations);

      let highlightCount = 0;

      console.log('🎯 Creating highlights for', violations.length, 'violations...');

      violations.forEach((violation, vIdx) => {
        if (!violation.nodes || violation.nodes.length === 0) {
          console.log(`⚠️ Violation ${vIdx} has no nodes`);
          return;
        }

        violation.nodes.forEach((node, nIdx) => {
          try {
            // Get the actual DOM element
            const target = node.target || [];
            if (target.length === 0) {
              console.log(`⚠️ Node ${nIdx} in violation ${vIdx} has no target`);
              return;
            }

            // Use the first selector to find the element
            const selector = target[0];
            const element = document.querySelector(selector);

            if (element && element.getBoundingClientRect) {
              createHighlight(element, violation, node);
              highlightCount++;
            } else {
              console.log(`⚠️ Could not find element for selector: ${selector}`);
            }
          } catch (e) {
            console.warn('Could not highlight element:', e);
          }
        });
      });

      console.log(`✅ Created ${highlightCount} highlights`);
      
      // Add event listeners only once
      if (!window.accessGuruListenersAdded) {
        console.log('🎧 Adding scroll/resize listeners...');
        window.addEventListener('resize', handleResize);
        window.addEventListener('scroll', handleScroll, true);
        window.accessGuruListenersAdded = true;
      }
    } catch (error) {
      console.error('❌ Error in highlightViolations:', error);
    }
  }

  // Expose global function for extension to call
  window.accessGuruHighlight = highlightViolations;
  window.accessGuruRemoveOverlays = removeAllOverlays;
  
  // Function to open the sidebar
  window.accessGuruOpenSidebar = function() {
    if (sidePanel) {
      sidePanel.classList.remove('collapsed');
      sidePanel.style.transform = 'translateX(0)';
    }
  };
  
  // Function to highlight a single violation
  window.accessGuruHighlightSingle = function(violation) {
    console.log('🎯 Highlighting single violation:', violation);
    
    // Remove existing overlays first
    removeAllOverlays();
    
    // Highlight with single violation
    highlightViolations([violation]);
    
    // Auto-open the panel
    if (sidePanel) {
      sidePanel.classList.remove('collapsed');
      sidePanel.style.transform = 'translateX(0)';
    }
  };

  console.log('AccessGuru overlay system loaded');
})();