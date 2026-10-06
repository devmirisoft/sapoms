import { parseAdminPagination } from "@/server/admin/admin-pagination";

// The admin catalogue page loads every product and filters in the browser.
// ponytail: client-side filtering; move search server-side if the catalogue passes a few thousand products.
export const parseAdminProductListInput = (searchParams: URLSearchParams) => parseAdminPagination(searchParams, 5000);
