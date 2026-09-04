# H2A2H site

Static HTML/CSS/JS implementation of the H2A2H landing-page concept.

## Files

- `index.html` — semantic page structure and H2A2H content.
- `styles.css` — responsive dark UI, protocol cards, diagrams and mobile layout.
- `app.js` — mobile navigation, section highlighting, reveal animations and the lightweight ambient network canvas.
- `assets/logo.svg` — scalable H2A2H wordmark used by the header and footer.

## Run locally

No build step or package installation is required. Serve the repository root with any static HTTP server, for example:

```sh
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/site/
```

The layout is responsive and has a `prefers-reduced-motion` fallback. All detailed protocol links point to the normative artifacts in this repository.
