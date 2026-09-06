import * as contactService from "./contact.service.js";

export async function submitContact(req, res) {
  const result = await contactService.submitContact(
    req.body,
    req.ip || req.headers["x-forwarded-for"] || "",
  );
  return res.status(200).json(result);
}
