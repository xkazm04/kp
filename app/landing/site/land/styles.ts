/*
 * Every stylesheet the landing needs, in the prototype's <link> order (index.html).
 * Imported ONCE, first thing, by the route shell (app/landing/spark/SparkHome.tsx).
 * Order is load-bearing: the chrome and landing sheets have equal selector weight
 * (.mk.mk vs .mk.mk-land), so ties resolve by this order, as they did in the
 * prototype. Add a new landing sheet HERE, at its place in the order; never import
 * a scoped sheet from a band component.
 */
import "../css/base.css";
import "../css/chrome.css";
import "../css/chrome-app.css";
import "../css/land-style.css";
import "../css/land-scenery.css";
import "../css/land-landing.css";
import "../css/land-proof.css";
import "../css/land-scene.css";
import "../css/land-mocks.css";
import "../css/land-mocks2.css";
import "../css/land-mocks-fuse.css";
