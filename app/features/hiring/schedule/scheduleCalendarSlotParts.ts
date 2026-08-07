// Pure helper shared by ScheduleCalendar and ScheduleCalendarCell: splits a
// dated slot ("YYYY-MM-DD HH:MM") into its date + hour-bucket parts. Split out
// of ScheduleCalendar.tsx so both files can use it without duplication.

export function slotParts(dateSlot: string): { date: string; hour: string; time: string; offHour: boolean } {
  const [date = "", time = ""] = dateSlot.split(" ");
  return { date, hour: time.slice(0, 2), time, offHour: time.slice(3) !== "00" };
}
