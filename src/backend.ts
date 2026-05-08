/**
 * Inject your marketplace HTTP client behind this interface (e.g. Next.js server
 * adapter calling `/api/core` with Bearer + UserType headers).
 */
export interface BookingAgentBackend {
  fetchBookingsList(input: {
    status: string;
    page: number;
    perPage: number;
  }): Promise<unknown>;

  fetchReservationDetail(reservationId: string): Promise<unknown>;

  fetchBookingByCheckoutId(bookingId: string): Promise<unknown>;

  postCheckAvailability(payload: Record<string, unknown>): Promise<unknown>;

  fetchListingSnapshot(input: {
    url: string;
    uuid?: string;
    platform: string;
    hostView: boolean;
  }): Promise<unknown>;

  /**
   * Optional web search hook. Only invoked when the caller passes
   * `allowOutOfScope: true` to `runBookingAgentTurn`. Implement against
   * any provider you want (SerpAPI, Bing, Google CSE, your own crawler)
   * and return whatever JSON-serializable structure the model can read.
   */
  webSearch?(input: { query: string; maxResults?: number }): Promise<unknown>;
}
