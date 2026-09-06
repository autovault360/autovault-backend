import * as supportService from "./support.service.js";
import { forbidden } from "../../common/errors.js";

export async function createSupportMessage(req, res) {
  if (!req.auth?.dealershipId) {
    throw forbidden("No dealership context on this account.");
  }

  const message = await supportService.createSupportMessage({
    dealershipId: req.auth.dealershipId,
    userId: req.auth.userId,
    name: req.body.name || req.auth.name,
    role: req.auth.role,
    email: req.auth.email,
    topic: req.body.topic,
    subject: req.body.subject,
    priority: req.body.priority,
    message: req.body.message,
  });

  return res.status(201).json({ message });
}
