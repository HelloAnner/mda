---
name: web-quality-audit
description: Comprehensive web quality audit covering performance, accessibility, SEO, and best practices. Use when asked to "audit my site", "review web quality", "run lighthouse audit", "check page quality", or "optimize my website".
license: MIT
metadata:
  author: web-quality-skills
  version: "1.0"
  upstream-revision: 95d6e255afe1596b557d7a8498517884438f5b3a
  mda-adapted: "true"
---
<!--
Adapted by MDA from addyosmani/web-quality-skills at the revision above.
Changes: added MDA ownership/capability triage and replaced links to uninstalled
sibling Skills so the catalog has one semantic owner for the final audit.
-->

# Web quality audit

Comprehensive quality review based on Google Lighthouse audits. Covers Performance, Accessibility, SEO, and Best Practices across 150+ checks.

## MDA audit profile

Audit the exact current dashboard source after functional testing. First classify every potential finding:

- **Agent-owned:** React, CSS, SVG, public assets, semantic markup rendered by source, focus behavior, responsive layout, data-state behavior, direct network attempts, excessive client work, and console errors. Fix critical and high findings before completion.
- **Platform-owned:** the fixed HTML shell, HTTP headers, CSP delivery, HTTPS, iframe/origin policy, cache headers, artifact hosting, source-map policy, authentication, and publication infrastructure. Do not edit protected files to simulate a fix; report the finding with the owning boundary.
- **Unverified:** Lighthouse/Core Web Vitals measurements, real-network timing, screen-reader behavior, browser compatibility, security headers, or deployed SEO behavior when the required browser, URL, field data, assistive technology, or hosting access is unavailable. Never mark these as passed from source review alone.

For ordinary authenticated dashboards, prioritize accessibility, performance, security, and best practices. Apply SEO only when public discoverability is an approved requirement; do not add robots, sitemap, canonical, structured-data, or shell metadata files outside MDA's source contract.

The bundled `scripts/analyze.sh` is an optional read-only HTML heuristic for environments that already provide Bash and `jq`. It is not Lighthouse, does not analyze rendered React output by itself, and must not be reported as a comprehensive audit.

> **Lighthouse v13 note (Oct 2025+).** Lighthouse has migrated the Performance category from per-opportunity audits to **Performance Insight Audits** ([announcement](https://developer.chrome.com/blog/moving-lighthouse-to-insights)). Several individual audit names this skill historically referenced — *First Meaningful Paint*, *No Document Write*, *Uses Passive Event Listeners*, *Uses Rel Preload* — have been removed or merged. The underlying *advice* is unchanged and still applies; only the report format moved. The CLS-related audits ("layout shifts", "non-composited animations", "unsized images") are now consolidated into a single `cls-culprits-insight`, and image audits are merged into `image-delivery-insight`. Treat older Lighthouse JSON output as a superset, not a contradiction.

## How it works

1. Analyze the provided code/project for quality issues
2. Categorize findings by severity (Critical, High, Medium, Low)
3. Provide specific, actionable recommendations
4. Include code examples for fixes

## Audit categories

### Performance (40% of typical issues)

**Core Web Vitals** — Must pass for good page experience:
* **LCP (Largest Contentful Paint) < 2.5s.** The largest visible element must render quickly. Optimize images, fonts, and server response time.
* **INP (Interaction to Next Paint) < 200ms.** User interactions must feel instant. Reduce JavaScript execution time and break up long tasks.
* **CLS (Cumulative Layout Shift) < 0.1.** Content must not jump around. Set explicit dimensions on images, embeds, and ads.

**Resource Optimization:**
* **Compress images.** Use WebP/AVIF with fallbacks. Serve correctly sized images via `srcset`.
* **Minimize JavaScript.** Remove unused code. Use code splitting. Defer non-critical scripts.
* **Optimize CSS.** Extract critical CSS. Remove unused styles. Avoid `@import`.
* **Efficient fonts.** Use `font-display: swap`. Preload critical fonts. Subset to needed characters.

**Loading Strategy:**
* **Preconnect to origins.** Add `<link rel="preconnect">` for third-party domains.
* **Preload critical assets.** LCP images, fonts, and above-fold CSS.
* **Lazy load below-fold content.** Images, iframes, and heavy components.
* **Cache effectively.** Long cache TTLs for static assets. Immutable caching for hashed files.

### Accessibility (30% of typical issues)

**Perceivable:**
* **Text alternatives.** Every `<img>` has meaningful `alt` text. Decorative images use `alt=""`.
* **Color contrast.** Minimum 4.5:1 for normal text, 3:1 for large text (WCAG AA).
* **Don't rely on color alone.** Use icons, patterns, or text alongside color indicators.
* **Captions and transcripts.** Video has captions. Audio has transcripts.

**Operable:**
* **Keyboard accessible.** All functionality available via keyboard. No keyboard traps.
* **Focus visible.** Clear focus indicators on all interactive elements.
* **Skip links.** Provide "Skip to main content" for keyboard users.
* **Sufficient time.** Users can extend time limits. No auto-advancing content without controls.

**Understandable:**
* **Page language.** Set `lang` attribute on `<html>`.
* **Consistent navigation.** Same navigation structure across pages.
* **Error identification.** Form errors clearly described and associated with fields.
* **Labels and instructions.** All form inputs have associated labels.

**Robust:**
* **Valid HTML.** No duplicate IDs. Properly nested elements.
* **ARIA used correctly.** Prefer native elements. ARIA roles match behavior.
* **Name, role, value.** Interactive elements have accessible names and correct roles.

### SEO (15% of typical issues)

**Crawlability:**
* **Valid robots.txt.** Doesn't block important resources.
* **XML sitemap.** Lists all important pages. Submitted to Search Console.
* **Canonical URLs.** Prevent duplicate content issues.
* **No noindex on important pages.** Check meta robots and headers.

**On-Page SEO:**
* **Unique title tags.** 50-60 characters. Primary keyword included.
* **Meta descriptions.** 150-160 characters. Compelling and unique.
* **Heading hierarchy.** Single `<h1>`. Logical heading structure.
* **Descriptive link text.** Not "click here" or "read more".

**Technical SEO:**
* **Mobile-friendly.** Responsive design. Tap targets ≥ 48px.
* **HTTPS.** Secure connection required.
* **Fast loading.** Performance directly impacts ranking.
* **Structured data.** JSON-LD for rich snippets (Article, Product, FAQ, etc.).

### Best practices (15% of typical issues)

**Security:**
* **HTTPS everywhere.** No mixed content. HSTS enabled.
* **No vulnerable libraries.** Keep dependencies updated.
* **CSP headers.** Content Security Policy to prevent XSS.
* **No exposed source maps.** In production builds.

**Modern Standards:**
* **No deprecated APIs.** Replace `document.write`, synchronous XHR, etc.
* **Valid doctype.** Use `<!DOCTYPE html>`.
* **Charset declared.** `<meta charset="UTF-8">` as first element in `<head>`.
* **No browser errors.** Clean console. No CORS issues.

**UX Patterns:**
* **No intrusive interstitials.** Especially on mobile.
* **Clear permission requests.** Only ask when needed, with context.
* **No misleading buttons.** Buttons do what they say.

## Severity levels

| Level | Description | Action |
|-------|-------------|--------|
| **Critical** | Security vulnerabilities, complete failures | Fix immediately |
| **High** | Core Web Vitals failures, major a11y barriers | Fix before launch |
| **Medium** | Performance opportunities, SEO improvements | Fix within sprint |
| **Low** | Minor optimizations, code quality | Fix when convenient |

## Audit output format

When performing an audit, structure findings as:

```markdown
## Audit results

### Critical issues (X found)
- **[Category]** Issue description. File: `path/to/file.js:123`
  - **Impact:** Why this matters
  - **Fix:** Specific code change or recommendation

### High priority (X found)
...

### Summary
- Performance: X issues (Y critical)
- Accessibility: X issues (Y critical)
- SEO: X issues
- Best Practices: X issues

### Recommended priority
1. First fix this because...
2. Then address...
3. Finally optimize...
```

## Quick checklist

### Before every deploy
- [ ] Core Web Vitals passing
- [ ] No accessibility errors (axe/Lighthouse)
- [ ] No console errors
- [ ] HTTPS working
- [ ] Meta tags present

### Weekly review
- [ ] Check Search Console for issues
- [ ] Review Core Web Vitals trends
- [ ] Update dependencies
- [ ] Test with screen reader

### Monthly deep dive
- [ ] Full Lighthouse audit
- [ ] Performance profiling
- [ ] Accessibility audit with real users
- [ ] SEO keyword review

## MDA completion rule

Fix every critical and high Agent-owned issue supported by evidence. Re-run the available build and functional checks after fixes. Report platform-owned and unverified items separately; never convert missing tooling into a passing score.

## Upstream reference

This consolidated audit is vendored from `addyosmani/web-quality-skills`. Its upstream repository contains deeper performance, Core Web Vitals, accessibility, SEO, and best-practice Skills; MDA does not install those separately because their semantics are already owned by this final gate and the React/testing Skills.
