import * as contactService from "./contact.service.js";
import { sendLeadCapi } from "../../lib/meta-capi.js";

export async function submitContact(req, res) {
  const result = await contactService.submitContact(
    req.body,
    req.ip || req.headers["x-forwarded-for"] || "",
  );
  if (!result?.ignored) {
    sendLeadCapi(req, {
      eventId: req.body?.eventId,
      email: req.body?.email,
      phone: req.body?.phone,
    });
  }
  return res.status(200).json(result);
}
