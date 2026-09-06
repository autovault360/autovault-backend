export const PLAN_LABEL_TO_SLUG = {
  Wholesaler: "wholesaler",
  Wholesalers: "wholesaler",
  "Independent Dealer": "independent_dealer",
  "Independent Dealers": "independent_dealer",
  "Growing Dealership": "growing_dealership",
  "Growing Dealerships": "growing_dealership",
  "Fully Loaded": "growing_dealership",
};

export const PLAN_SLUG_TO_LABEL = {
  wholesaler: "Wholesalers",
  independent_dealer: "Independent Dealers",
  growing_dealership: "Fully Loaded",
};

export const PLAN_TO_PRICE_ENV = {
  wholesaler: "STRIPE_WHOLESALER_PRICE_ID",
  independent_dealer: "STRIPE_INDEPENDENT_DEALER_PRICE_ID",
  growing_dealership: "STRIPE_GROWING_DEALERSHIP_PRICE_ID",
};

/** Recurring monthly fee after the free first month (Stripe trial). */
export const PLAN_MONTHLY_FEE = {
  wholesaler: 99.99,
  independent_dealer: 99.99,
  growing_dealership: 199.99,
};

/** Free first month on new subscriptions (onboarding checkout only). */
export const SUBSCRIPTION_TRIAL_DAYS = 30;

export const REGISTRATION_STATUSES = [
  "pending",
  "checkout_started",
  "active",
  "payment_failed",
  "canceled",
];

export const PAYMENT_STATUSES = ["pending", "on-time", "behind"];

/** Prisma enum -> frontend API string */
export function toApiPaymentStatus(status) {
  if (status === "on_time") return "on-time";
  return status;
}

/** Frontend API string -> Prisma enum */
export function toPrismaPaymentStatus(status) {
  if (status === "on-time") return "on_time";
  return status;
}

export const PLAN_HIERARCHY = {
  wholesaler: 0,
  independent_dealer: 1,
  growing_dealership: 2,
};

export const PLAN_LABELS = {
  wholesaler: "Wholesalers",
  independent_dealer: "Independent Dealers",
  growing_dealership: "Fully Loaded",
};

export const PLAN_FEATURES = {
  wholesaler: {
    payroll: false,
    salesReps: false,
    messaging: false,
    multipleAdmins: false,
    cpa: false,
    teamManagement: false,
    wholesaleCrm: true,
  },
  independent_dealer: {
    payroll: false,
    salesReps: false,
    messaging: false,
    multipleAdmins: false,
    cpa: true,
    teamManagement: false,
    wholesaleCrm: false,
  },
  growing_dealership: {
    payroll: true,
    salesReps: true,
    messaging: true,
    multipleAdmins: true,
    cpa: true,
    teamManagement: true,
    wholesaleCrm: false,
  },
};

/** Marketing blurbs for Payment Settings / upgrade UI */
export const PLAN_MARKETING = {
  wholesaler:
    "Move cars fast and know your numbers at every auction — Jenna AI, VIN-tied inventory, dealer-to-dealer logs & flooring costs",
  independent_dealer:
    "Everything to run your retail lot — Jenna AI, full inventory, customer deals, flooring costs & every expense",
  growing_dealership:
    "One plan, every feature — inventory, deals, flooring, expenses, tax, payroll, CPA login, and Jenna AI",
};

export const PLAN_SLUGS = [
  "wholesaler",
  "independent_dealer",
  "growing_dealership",
];

export function priceEnvKeyForPlan(plan) {
  return PLAN_TO_PRICE_ENV[plan] || "";
}

export function planHasFeature(plan, feature) {
  return PLAN_FEATURES[plan]?.[feature] === true;
}

export function serializeRegistration(reg) {
  if (!reg) return null;
  return {
    id: reg.id,
    name: reg.name,
    email: reg.email,
    phone: reg.phone,
    dealership: reg.dealershipName,
    dealershipName: reg.dealershipName,
    zipCode: reg.zipCode,
    state: reg.state,
    plan: reg.plan,
    planLabel: PLAN_SLUG_TO_LABEL[reg.plan] || "Dealership Plan",
    status: reg.status,
    paymentStatus: toApiPaymentStatus(reg.paymentStatus),
    monthlyFee: reg.monthlyFee != null ? Number(reg.monthlyFee) : null,
    createdAt: reg.createdAt,
    updatedAt: reg.updatedAt,
  };
}
