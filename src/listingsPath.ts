/** Account type ids as returned by the marketplace auth layer ("1" guest, "2" host, "3" agent). */
export function bookingsListPathForAccountType(accountTypeId: string): string {
  switch (accountTypeId) {
    case "2":
      return "/properties/reservations-list";
    case "3":
      return "/properties/agent/trips-list";
    case "1":
    default:
      return "/properties/trips-list";
  }
}
