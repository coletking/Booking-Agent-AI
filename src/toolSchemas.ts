import { z } from "zod";

export const listMyBookingsSchema = z.object({
  status: z.string().optional(),
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(50).optional(),
});

export const getBookingDetailSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  reservation_id: z.union([z.string(), z.number()]).optional(),
});

export const getBookingByPaymentIdSchema = z.object({
  booking_id: z.union([z.string(), z.number()]),
});

export const checkAvailabilitySchema = z.object({
  /** Forwarded as JSON body to check-availability (may include nested arrays, e.g. rooms). */
  payload: z.record(z.string(), z.any()),
});

export const getListingSnapshotSchema = z.object({
  url: z.string().min(1),
  uuid: z.string().optional(),
  property_uuid: z.string().optional(),
  property_url: z.string().optional(),
  platform: z.string().optional(),
  use_my_listing: z.boolean().optional(),
  host_view: z.boolean().optional(),
});

export const webSearchSchema = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(10).optional(),
});

export function schemaErrorJson(err: z.ZodError): string {
  return JSON.stringify({
    error: "Invalid tool arguments",
    details: err.flatten(),
  });
}
