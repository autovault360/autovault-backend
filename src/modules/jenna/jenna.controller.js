import * as jennaService from "./jenna.service.js";

export async function chat(req, res) {
  const result = await jennaService.chat(
    req.auth.dealershipId,
    req.body,
    { userId: req.auth.userId, role: req.auth.role },
  );
  return res.json(result);
}

export async function status(_req, res) {
  return res.json(jennaService.jennaStatus());
}
