import { buildGmailIntakeUseCase } from "./gmailIntakeWiring.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";

function parseMccArg(): string | null {
  const idx = process.argv.indexOf("--mcc");
  return idx !== -1 && process.argv[idx + 1] ? (process.argv[idx + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const mcc = parseMccArg();
  if (!mcc) {
    console.error("Usage: pnpm gmail:web-search -- --mcc 537-706-1556");
    process.exitCode = 1;
    return;
  }

  const useCase = buildGmailIntakeUseCase();
  const result = await useCase.search(mcc, "cli:gmail:web-search");

  console.log(JSON.stringify(result, null, 2));

  if (result.status === "MATCH_FOUND") {
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
