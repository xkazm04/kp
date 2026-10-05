import FeatureRing from "./FeatureRing";

/*
 * The features band (prototype index.html `.features#features`): the torn edge,
 * then the ring of nine medallions with the stage in its middle. Everything
 * inside the ring is interactive (hover and focus name a medallion, a click
 * opens its scene, the scene steps through all nine), so the ring is one client
 * component, still server-rendered: the heading, the nine medallions and their
 * names are in the HTML a crawler reads. The scene itself is portalled into the
 * site root on the client and addressable as `/#spotlight-<key>` (see
 * FeatureRing.tsx).
 *
 * `signupOpen` reaches the scene's "Start hiring free" (server-resolved in
 * app/page.tsx, see chrome/Ctas StartCta).
 */
export default function Features({ signupOpen = false }: { signupOpen?: boolean }) {
  return (
    <section className="sec features" id="features" aria-labelledby="featH">
      <svg className="edge" viewBox="0 0 1600 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 60V26Q220 -2 440 20T880 24T1240 12T1600 26V60Z" />
      </svg>
      <div className="wrap wide">
        <FeatureRing signupOpen={signupOpen} />
      </div>
    </section>
  );
}
