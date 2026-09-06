/** Three top-level expense categories used by the CRM. */
export const EXPENSE_CATEGORIES = [
  "Vehicle Expense",
  "Recurring Expense",
  "Dealership Expense",
];

export const EXPENSE_TYPES = {
  "Vehicle Expense": [
    "Repairs",
    "Tires",
    "Oil change",
    "Detailing",
    "Transportation",
    "Auction fees",
    "DMV / registration",
    "Other",
  ],
  "Recurring Expense": [
    "Rent",
    "Payroll",
    "Utilities",
    "Flooring fees",
    "Insurance",
    "Subscriptions",
    "Commissions",
    "Other",
  ],
  "Dealership Expense": [
    "Office furniture",
    "Computers / equipment",
    "Renovations",
    "Concrete / building",
    "Marketing",
    "Supplies",
    "Other",
  ],
};

/** Map legacy flat categories onto the three top-level ones. */
export const EXP_LEGACY_MAP = {
  Rent: "Recurring Expense",
  Payroll: "Recurring Expense",
  Commissions: "Recurring Expense",
  Utilities: "Recurring Expense",
  Insurance: "Recurring Expense",
  "Software / subscriptions": "Recurring Expense",
  "Flooring fees": "Recurring Expense",
  "Auction fees": "Vehicle Expense",
  "Vehicle repairs": "Vehicle Expense",
  "Transportation fees": "Vehicle Expense",
  "DMV / registration fees": "Vehicle Expense",
  "Office expenses": "Dealership Expense",
  "Marketing / advertising": "Dealership Expense",
  Miscellaneous: "Dealership Expense",
};

export const EXP_LEGACY_TYPE = {
  Rent: "Rent",
  Payroll: "Payroll",
  Commissions: "Commissions",
  Utilities: "Utilities",
  Insurance: "Insurance",
  "Software / subscriptions": "Subscriptions",
  "Flooring fees": "Flooring fees",
  "Auction fees": "Auction fees",
  "Vehicle repairs": "Repairs",
  "Transportation fees": "Transportation",
  "DMV / registration fees": "DMV / registration",
  "Office expenses": "Office furniture",
  "Marketing / advertising": "Marketing",
  Miscellaneous: "Other",
};

/**
 * Normalize a raw DB row's category/subcategory for API responses.
 * Does not mutate the database — SQL migration handles persistence.
 */
export function normalizeExpenseCategory(category, subcategory, vehicleVin) {
  if (EXPENSE_CATEGORIES.includes(category)) {
    return {
      category,
      subcategory: subcategory || "Other",
    };
  }
  const mappedCategory = vehicleVin
    ? "Vehicle Expense"
    : EXP_LEGACY_MAP[category] || "Dealership Expense";
  return {
    category: mappedCategory,
    subcategory: subcategory || EXP_LEGACY_TYPE[category] || "Other",
  };
}
