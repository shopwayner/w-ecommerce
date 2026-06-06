import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const organizationSlug = "wayner-master";
const category = "Pecas Moto";
const origin = "Teste local";
const status = "READY_FOR_TEST";

const products = [
  { sku: "TEST-001", name: "TUBO INT BENG XRE300", unit: "UN", displayValue: "54,185" },
  { sku: "TEST-002", name: "TENSOR CORR COMAN TITAN150 04-15/BROS150", unit: "UN", displayValue: "3,901" },
  { sku: "TEST-003", name: "SOQUETE FAROL BIZ125 11-17/BIZ100 13- M", unit: "UN", displayValue: "3,019" },
  { sku: "TEST-004", name: "ROSCA POSTI VELA BIZ100-110-125/POP", unit: "UN", displayValue: "1,004" },
  { sku: "TEST-005", name: "ROLDANA ACEL TITAN/FAN/START/POP/CARGO", unit: "UN", displayValue: "0,881" },
  { sku: "TEST-006", name: "RETIF CORR LANDER250/NMAX/XMAX/NEO 5PINO", unit: "UN", displayValue: "21,173" },
  { sku: "TEST-007", name: "RETIF CORR FAC/XTZ125 14-15/FZ150 14-15", unit: "UN", displayValue: "16,292" },
  { sku: "TEST-008", name: "RAIO INOX T CAB COBRE BROS160 EDD/XRE190", unit: "JO", displayValue: "34,698" }
];

function assertLocalEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed de produtos de teste bloqueado em NODE_ENV=production.");
  }
}

async function main() {
  assertLocalEnvironment();

  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true }
  });

  if (!organization) {
    throw new Error("Organizacao local wayner-master nao encontrada. Execute npm.cmd run prisma:seed antes deste seed.");
  }

  for (const item of products) {
    const product = await prisma.product.upsert({
      where: {
        organizationId_sku: {
          organizationId: organization.id,
          sku: item.sku
        }
      },
      update: {
        name: item.name,
        ean: null,
        category,
        brand: origin,
        status,
        blockedFields: {
          testSeed: true,
          unit: item.unit,
          origin,
          displayValue: item.displayValue,
          salePriceDisplay: "0,00"
        }
      },
      create: {
        organizationId: organization.id,
        sku: item.sku,
        ean: null,
        name: item.name,
        category,
        brand: origin,
        status,
        blockedFields: {
          testSeed: true,
          unit: item.unit,
          origin,
          displayValue: item.displayValue,
          salePriceDisplay: "0,00"
        }
      }
    });

    const currentPrice = await prisma.productPrice.findFirst({
      where: { organizationId: organization.id, productId: product.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" }
    });

    if (currentPrice) {
      await prisma.productPrice.update({
        where: { id: currentPrice.id },
        data: { costPrice: 0, salePrice: 0, status: "ACTIVE" }
      });
    } else {
      await prisma.productPrice.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          costPrice: 0,
          salePrice: 0,
          status: "ACTIVE"
        }
      });
    }
  }

  console.log(`Seed local concluido: ${products.length} produtos de teste inseridos/atualizados.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Seed de produtos de teste falhou.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
