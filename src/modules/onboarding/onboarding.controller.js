import * as registrationService from "./registration.service.js";
import * as checkoutService from "./checkout.service.js";
import * as webhookService from "./webhook.service.js";

export async function upsertRegistration(req, res) {
  const result = await registrationService.upsertRegistration(req.body);
  return res.status(result.created ? 201 : 200).json({
    registrationId: result.registrationId,
    status: result.status,
  });
}

export async function completeRegistration(req, res) {
  const result = await registrationService.completeRegistration(req.query.token);
  return res.json(result);
}

export async function createCheckout(req, res) {
  const result = await checkoutService.createCheckout(req.body);
  return res.json(result);
}

export async function handleStripeWebhook(req, res) {
  try {
    const signature = req.headers["stripe-signature"];
    const result = await webhookService.handleStripeWebhook(req.body, signature);
    return res.json(result);
  } catch (error) {
    if (error.type === "StripeSignatureVerificationError") {
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }
    throw error;
  }
}

export async function listRegistrations(req, res) {
  const result = await registrationService.listRegistrations(req.query.q);
  return res.json(result);
}

export async function getRegistration(req, res) {
  const result = await registrationService.getRegistrationById(req.params.id);
  return res.json(result);
}
