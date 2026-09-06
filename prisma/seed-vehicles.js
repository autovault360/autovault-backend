/**
 * Seeds a dealership with a batch of vehicles using realistic, coherent data.
 *
 * Usage:
 *   node prisma/seed-vehicles.js <dealershipId|slug|email|name> [count] [options]
 *
 * Options:
 *   --status <status>   Force one status for every vehicle
 *                       (in_stock | needs_attention | pending_deal | sold | loss | wholesale | out_of_state_sale)
 *   --wipe              Delete the dealership's existing active vehicles before seeding
 *   --dry-run           Generate and print the vehicles without inserting anything
 *
 * Examples:
 *   node prisma/seed-vehicles.js 0b4a3f2a-1111-2222-3333-444455556666 50
 *   node prisma/seed-vehicles.js autovault-wholesale-demo 30 --status in_stock --wipe --dry-run
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const DEALERSHIP_REF = (positional[0] || "").trim();
const COUNT = Math.min(Math.max(parseInt(positional[1], 10) || 25, 1), 1000);
const DRY_RUN = args.includes("--dry-run");
const WIPE = args.includes("--wipe");

const statusIdx = args.indexOf("--status");
const FORCE_STATUS = statusIdx >= 0 ? (args[statusIdx + 1] || "").toLowerCase() : null;

const VALID_STATUSES = ["in_stock", "needs_attention", "pending_deal", "sold", "loss", "wholesale", "out_of_state_sale"];

if (!DEALERSHIP_REF) {
  console.log("Usage: node prisma/seed-vehicles.js <dealershipId|slug|email|name> [count] [options]");
  process.exit(1);
}
if (FORCE_STATUS && !VALID_STATUSES.includes(FORCE_STATUS)) {
  console.error(`Invalid --status "${FORCE_STATUS}". Valid: ${VALID_STATUSES.join(", ")}`);
  process.exit(1);
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const roundTo = (n, step) => Math.round(n / step) * step;

const VIN_CHARS = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ";
const PLATE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomVin() {
  let vin = "";
  for (let i = 0; i < 17; i++) vin += VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)];
  return vin;
}

function randomPlate(len = 7) {
  let plate = "";
  for (let i = 0; i < len; i++) plate += PLATE_CHARS[Math.floor(Math.random() * PLATE_CHARS.length)];
  return plate;
}

const EXTERIOR_COLORS = ["Black", "White", "Silver", "Gray", "Blue", "Red", "Green", "Dark Blue", "Gunmetal", "Pearl White"];
const INTERIOR_COLORS = ["Black", "Beige", "Gray", "Tan", "Brown", "Dark Gray", "Ivory", "Red"];
const STATES = ["AL", "AZ", "CA", "CO", "FL", "GA", "IL", "MD", "MI", "MO", "NC", "NJ", "NV", "NY", "OH", "OR", "PA", "TN", "TX", "UT", "VA", "WA", "WI"];
const AUCTIONS = ["Manheim", "Copart", "IAA", "Adesa", "Local Dealer Exchange"];
const PURCHASE_TYPES = ["Auction", "Trade-In", "Dealer Purchase", "Private Sale"];
const TITLES = ["CLEAN", "CLEAN", "CLEAN", "CLEAN", "SALVAGE"];
const NOTES = [
  "Clean title, one-owner vehicle, dealer-maintained.",
  "Fresh trade-in, ready for the lot.",
  "Low-mileage example with full service history.",
  "Recent auction acquisition with clean history report.",
  "One-owner, garage-kept, no accidents reported.",
  "Well-maintained; recent oil change and new tires.",
  "Certified pre-owned candidate, runs and drives excellent.",
  "Immaculate interior, all maintenance records available.",
];

const ENGINE_BY_CLASS = {
  sedan: ["2.0L I-4", "1.5L Turbo I-4", "2.5L I-4", "3.6L V6", "2.0L Turbo I-4"],
  suv: ["2.0L Turbo I-4", "2.5L I-4", "3.6L V6", "5.3L V8"],
  pickup: ["3.5L V6", "5.0L V8", "6.2L V8", "3.0L Turbo Diesel V6"],
  coupe: ["2.3L EcoBoost I-4", "5.0L V8"],
  wagon: ["2.5L Boxer 4-cyl", "2.4L Turbo 4-cyl"],
  hatchback: ["2.0L I-4", "1.8L I-4", "2.0L Turbo I-4"],
};

const TRANSMISSION_BY_CLASS = {
  sedan: ["CVT", "8-Speed Automatic", "9-Speed Automatic"],
  suv: ["CVT", "8-Speed Automatic", "10-Speed Automatic"],
  pickup: ["8-Speed Automatic", "10-Speed Automatic"],
  coupe: ["10-Speed Automatic", "6-Speed Manual"],
  wagon: ["CVT", "8-Speed Automatic"],
  hatchback: ["CVT", "6-Speed Manual", "8-Speed Automatic"],
};

const DRIVETRAIN_BY_CLASS = {
  sedan: ["FWD", "FWD", "AWD"],
  suv: ["AWD", "FWD", "AWD"],
  pickup: ["4WD", "2WD", "4WD"],
  coupe: ["RWD"],
  wagon: ["AWD"],
  hatchback: ["FWD", "AWD"],
};

const BASE_BY_CLASS = {
  sedan: 21000,
  suv: 27000,
  pickup: 33000,
  coupe: 26000,
  wagon: 24000,
  hatchback: 20000,
};

const CATALOG = [
  { make: "Honda", model: "Civic", bodyStyle: "Sedan", class: "sedan", trims: ["LX", "Sport", "EX", "Touring"], doors: 4 },
  { make: "Honda", model: "Accord", bodyStyle: "Sedan", class: "sedan", trims: ["LX", "Sport", "EX-L", "Touring"], doors: 4 },
  { make: "Honda", model: "CR-V", bodyStyle: "SUV", class: "suv", trims: ["LX", "EX", "EX-L", "Sport", "Touring"], doors: 5 },
  { make: "Toyota", model: "Camry", bodyStyle: "Sedan", class: "sedan", trims: ["LE", "SE", "XLE", "XSE"], doors: 4 },
  { make: "Toyota", model: "Corolla", bodyStyle: "Sedan", class: "sedan", trims: ["L", "LE", "SE"], doors: 4 },
  { make: "Toyota", model: "RAV4", bodyStyle: "SUV", class: "suv", trims: ["LE", "XLE", "XLE Premium", "Limited"], doors: 5 },
  { make: "Toyota", model: "Tacoma", bodyStyle: "Pickup Truck", class: "pickup", trims: ["SR", "SR5", "TRD Off-Road"], doors: 4 },
  { make: "Ford", model: "F-150", bodyStyle: "Pickup Truck", class: "pickup", trims: ["XL", "XLT", "Lariat", "Platinum"], doors: 4 },
  { make: "Ford", model: "Mustang", bodyStyle: "Coupe", class: "coupe", trims: ["EcoBoost", "GT", "GT Premium"], doors: 2 },
  { make: "Chevrolet", model: "Silverado 1500", bodyStyle: "Pickup Truck", class: "pickup", trims: ["WT", "LT", "LTZ", "High Country"], doors: 4 },
  { make: "Chevrolet", model: "Malibu", bodyStyle: "Sedan", class: "sedan", trims: ["LS", "LT", "Premier"], doors: 4 },
  { make: "Chevrolet", model: "Tahoe", bodyStyle: "SUV", class: "suv", trims: ["LS", "LT", "Z71", "Premier"], doors: 5 },
  { make: "Ram", model: "1500", bodyStyle: "Pickup Truck", class: "pickup", trims: ["Big Horn", "Laramie", "Rebel"], doors: 4 },
  { make: "Nissan", model: "Altima", bodyStyle: "Sedan", class: "sedan", trims: ["S", "SV", "SL"], doors: 4 },
  { make: "Nissan", model: "Rogue", bodyStyle: "SUV", class: "suv", trims: ["S", "SV", "SL", "Platinum"], doors: 5 },
  { make: "Hyundai", model: "Elantra", bodyStyle: "Sedan", class: "sedan", trims: ["SE", "SEL", "Limited"], doors: 4 },
  { make: "Hyundai", model: "Santa Fe", bodyStyle: "SUV", class: "suv", trims: ["SE", "SEL", "Limited", "Calligraphy"], doors: 5 },
  { make: "Kia", model: "K5", bodyStyle: "Sedan", class: "sedan", trims: ["LXS", "GT-Line", "GT"], doors: 4 },
  { make: "Subaru", model: "Outback", bodyStyle: "Wagon", class: "wagon", trims: ["Base", "Premium", "Limited", "Touring"], doors: 5 },
  { make: "Jeep", model: "Wrangler", bodyStyle: "SUV", class: "suv", trims: ["Sport", "Sahara", "Rubicon"], doors: 4 },
  { make: "GMC", model: "Sierra 1500", bodyStyle: "Pickup Truck", class: "pickup", trims: ["SLE", "SLT", "Denali"], doors: 4 },
  { make: "Volkswagen", model: "Jetta", bodyStyle: "Sedan", class: "sedan", trims: ["S", "SE", "SEL"], doors: 4 },
  { make: "BMW", model: "3 Series", bodyStyle: "Sedan", class: "sedan", trims: ["330i", "330i xDrive", "M340i"], doors: 4 },
  { make: "Mercedes-Benz", model: "C-Class", bodyStyle: "Sedan", class: "sedan", trims: ["C300", "C300 4MATIC"], doors: 4 },
  { make: "Audi", model: "A4", bodyStyle: "Sedan", class: "sedan", trims: ["Premium", "Premium Plus"], doors: 4 },
  { make: "Mazda", model: "CX-5", bodyStyle: "SUV", class: "suv", trims: ["Sport", "Touring", "Grand Touring"], doors: 5 },
];

function pickStatus() {
  if (FORCE_STATUS) return FORCE_STATUS;
  const r = Math.random();
  if (r < 0.78) return "in_stock";
  if (r < 0.9) return "needs_attention";
  if (r < 0.97) return "pending_deal";
  return "wholesale";
}

function generateVehicle(entry, usedVins, usedStock) {
  const year = 2016 + rand(0, 10);
  const age = 2026 - year;
  const mileage = Math.max(5, age * 12500 + rand(-6000, 6000));
  const yearFactor = 0.72 + (year - 2015) * 0.032 + Math.random() * 0.05;
  const acquisitionCost = Math.max(3000, roundTo(BASE_BY_CLASS[entry.class] * yearFactor * (0.9 + Math.random() * 0.25), 100));
  const askingPrice = roundTo(acquisitionCost * (1.09 + Math.random() * 0.09), 50);
  const marketValue = roundTo(askingPrice * (0.96 + Math.random() * 0.08), 50);
  const wholesalePrice = roundTo(acquisitionCost * (0.92 + Math.random() * 0.1), 50);
  const reconditioningCost = chance(0.6) ? rand(150, 1800) : 0;
  const registrationFees = rand(150, 650);
  const auctionFees = rand(150, 500);
  const flooringFees = chance(0.5) ? rand(0, 350) : 0;
  const totalInvested = roundTo(acquisitionCost + reconditioningCost + registrationFees + auctionFees + flooringFees, 1);

  const acquisitionDate = new Date(Date.now() - rand(1, 180) * 86400000);
  const flooringStartDate = chance(0.7) ? new Date(acquisitionDate.getTime() + rand(0, 7) * 86400000) : null;
  const status = pickStatus();

  let vin = randomVin();
  while (usedVins.has(vin)) vin = randomVin();
  usedVins.add(vin);

  let stockNumber = `STK-${rand(1000, 9999)}`;
  while (usedStock.has(stockNumber)) stockNumber = `STK-${rand(1000, 9999)}`;
  usedStock.add(stockNumber);

  return {
    vin,
    stockNumber,
    make: entry.make,
    model: entry.model,
    trim: pick(entry.trims),
    year,
    bodyStyle: entry.bodyStyle,
    exteriorColor: pick(EXTERIOR_COLORS),
    interiorColor: pick(INTERIOR_COLORS),
    drivetrain: pick(DRIVETRAIN_BY_CLASS[entry.class]),
    fuelType: entry.fuelType || "Gasoline",
    engine: pick(ENGINE_BY_CLASS[entry.class]),
    transmission: pick(TRANSMISSION_BY_CLASS[entry.class]),
    mileage,
    doors: entry.doors,
    acquisitionDate,
    acquisitionCost,
    askingPrice,
    marketValue,
    wholesalePrice,
    reconditioningCost,
    registrationFees,
    auctionFees,
    flooringFees,
    totalInvested,
    additionalExpenses: 0,
    titleStatus: pick(TITLES),
    titleReceived: true,
    titlePresent: true,
    licensePlate: randomPlate(),
    state: pick(STATES),
    sellerAuction: pick(AUCTIONS),
    purchaseType: pick(PURCHASE_TYPES),
    notes: pick(NOTES),
    status,
    isWholesale: status === "wholesale",
    auctionRuns: status === "wholesale" ? rand(0, 3) : 0,
    flooringStartDate,
    soldAt: null,
    soldPrice: null,
    fees: {},
  };
}

async function main() {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(DEALERSHIP_REF);
  let dealership = null;
  if (isUuid) dealership = await prisma.dealership.findUnique({ where: { id: DEALERSHIP_REF } });
  if (!dealership) dealership = await prisma.dealership.findFirst({ where: { OR: [{ slug: DEALERSHIP_REF }, { email: DEALERSHIP_REF }] } });
  if (!dealership) dealership = await prisma.dealership.findFirst({ where: { name: { equals: DEALERSHIP_REF, mode: "insensitive" } } });

  if (!dealership) {
    console.error(`No dealership found for "${DEALERSHIP_REF}". Provide an id, slug, email, or name.`);
    process.exit(1);
  }

  console.log(`\nDealership: ${dealership.name} (${dealership.id})`);
  console.log(`Requested count: ${COUNT} vehicle(s)`);
  if (FORCE_STATUS) console.log(`Forced status:  ${FORCE_STATUS}`);
  if (DRY_RUN) console.log("Mode:           dry run (nothing will be inserted)");

  const creator = await prisma.user.findFirst({
    where: { dealershipId: dealership.id, isActive: true, deletedAt: null, role: { in: ["owner", "platform_owner", "manager"] } },
  });
  const createdById = creator ? creator.id : null;

  if (WIPE && !DRY_RUN) {
    const wiped = await prisma.vehicle.deleteMany({ where: { dealershipId: dealership.id, deletedAt: null } });
    console.log(`\nWiped ${wiped.count} existing active vehicle(s).`);
  }

  const existing = await prisma.vehicle.findMany({
    where: { dealershipId: dealership.id },
    select: { vin: true, stockNumber: true },
  });
  const usedVins = new Set(existing.map((v) => v.vin));
  const usedStock = new Set(existing.map((v) => v.stockNumber).filter(Boolean));

  const vehicles = Array.from({ length: COUNT }, () => generateVehicle(pick(CATALOG), usedVins, usedStock));

  if (DRY_RUN) {
    console.log(`\nGenerated ${vehicles.length} vehicle(s):`);
    for (const v of vehicles) {
      console.log(
        `  ${v.stockNumber}  ${v.year} ${v.make} ${v.model} ${v.trim}  ${v.mileage} mi  $${v.askingPrice.toLocaleString()}  ${v.status}  ${v.vin}`,
      );
    }
    return;
  }

  console.log(`\nInserting ${vehicles.length} vehicle(s)...`);
  const result = await prisma.vehicle.createMany({
    data: vehicles.map((v) => ({ ...v, dealershipId: dealership.id, createdById })),
  });
  console.log(`\n✓ Inserted ${result.count} vehicle(s) for ${dealership.name}.`);

  const stats = {};
  for (const v of vehicles) stats[v.status] = (stats[v.status] || 0) + 1;
  console.log("Status breakdown:");
  for (const [status, n] of Object.entries(stats)) console.log(`  ${status}: ${n}`);

  console.log("\nSample rows:");
  for (const v of vehicles.slice(0, 10)) {
    console.log(
      `  ${v.stockNumber}  ${v.year} ${v.make} ${v.model} ${v.trim}  ${v.mileage} mi  $${v.askingPrice.toLocaleString()}  ${v.status}`,
    );
  }
}

main()
  .catch((e) => {
    console.error("\nFailed to seed vehicles:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
