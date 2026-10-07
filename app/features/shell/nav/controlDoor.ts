// The in-app door to /control, the room that holds the Art. 22 human gates, the audit
// trail and the kill switch. One rule, in one place: the door exists for a caller
// isOperator() admits and for nobody else. app/control/page.tsx answers a non-operator
// notFound(), so a link shown to one would be a link to a 404 that also announces the
// room exists. The page's own gate is the wall; this only decides whether to draw a door.
export const CONTROL_ROOM_HREF = "/control";

export function controlRoomDoor(operator: boolean): { href: string } | null {
  return operator ? { href: CONTROL_ROOM_HREF } : null;
}
