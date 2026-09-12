export const SUBSCRIPTION_TRIAL_DAYS = 25;

export function addTrialDays(from = new Date(), days = SUBSCRIPTION_TRIAL_DAYS) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

export function hasPaidSubscription(dealership) {
  return !!(dealership?.stripeSubscriptionId);
}

export function isInFreeTrial(dealership, now = new Date()) {
  if (!dealership || hasPaidSubscription(dealership)) return false;
  if (!dealership.trialEndsAt) return false;
  return new Date(dealership.trialEndsAt).getTime() > now.getTime();
}

export function isTrialExpired(dealership, now = new Date()) {
  if (!dealership || hasPaidSubscription(dealership)) return false;
  if (!dealership.trialEndsAt) return false;
  return new Date(dealership.trialEndsAt).getTime() <= now.getTime();
}

export function trialDaysLeft(dealership, now = new Date()) {
  if (!isInFreeTrial(dealership, now)) return 0;
  const ms = new Date(dealership.trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function canUseProduct(dealership, now = new Date()) {
  if (!dealership || dealership.deletedAt) return false;
  if (dealership.status === "canceled" || dealership.status === "suspended") {
    return false;
  }
  if (hasPaidSubscription(dealership)) {
    return dealership.status === "active";
  }
  return isInFreeTrial(dealership, now);
}

export function isBillingRequired(dealership, now = new Date()) {
  if (!dealership || dealership.deletedAt) return false;
  if (dealership.status === "canceled" || dealership.status === "suspended") {
    return true;
  }
  if (hasPaidSubscription(dealership)) {
    return dealership.status === "payment_failed";
  }
  return isTrialExpired(dealership, now);
}

export function billingPhase(dealership, now = new Date()) {
  if (hasPaidSubscription(dealership)) {
    if (
      dealership.status === "payment_failed" ||
      dealership.paymentStatus === "behind"
    ) {
      return "past_due";
    }
    return "subscribed";
  }
  if (isInFreeTrial(dealership, now)) {
    return trialDaysLeft(dealership, now) <= 3 ? "trial_ending" : "trial";
  }
  if (isTrialExpired(dealership, now) || isBillingRequired(dealership, now)) {
    return "trial_ended";
  }
  return "unsubscribed";
}

export function trialPayload(dealership, now = new Date()) {
  const ends = dealership?.trialEndsAt ? new Date(dealership.trialEndsAt) : null;
  return {
    trialEndsAt: ends ? ends.toISOString() : null,
    trialDaysLeft: trialDaysLeft(dealership, now),
    inTrial: isInFreeTrial(dealership, now),
    billingRequired: isBillingRequired(dealership, now),
    subscribed: hasPaidSubscription(dealership),
    phase: billingPhase(dealership, now),
  };
}
