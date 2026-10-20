/*
 * Every stylesheet About needs, in the prototype's <link> order (about.html):
 * About's own sheets FIRST, then the shared chrome, then about-chrome. Imported
 * ONCE, first thing, by the route shell (app/landing/spark/AboutHome.tsx).
 * Order is load-bearing: About and the chrome have equal selector weight
 * (.mk.mk-about vs .mk.mk), so where both set a token or a property the later
 * sheet wins, as it did in the prototype (e.g. the chrome's --f-body over
 * tokens.css's). Add a new About sheet HERE, at its place in the order; never
 * import a scoped sheet from a chapter component.
 */
import "../css/base.css";
import "../css/about-tokens.css";
import "../css/about-art.css";
import "../css/about-frame.css";
import "../css/about-s1-design.css";
import "../css/about-s2-source.css";
import "../css/about-s3-intake.css";
import "../css/about-s4-screen.css";
import "../css/about-s5-assignment.css";
import "../css/about-s6-interview.css";
import "../css/about-s7-offer.css";
import "../css/about-s8-hired.css";
import "../css/about-main.css";
import "../css/about-a1.css";
import "../css/chrome.css";
import "../css/chrome-app.css";
import "../css/about-chrome.css";
