import * as searchService from "./search.service.js";
import { tenantId } from "../../common/auth-middleware.js";
import { forbidden } from "../../common/errors.js";

export async function globalSearch(req, res) {
  const dealershipId = tenantId(req);
  if (!dealershipId) throw forbidden("No dealership context on this account.");

  const result = await searchService.globalSearch(
    dealershipId,
    req.query,
    req.auth,
  );
  return res.json(result);
}
