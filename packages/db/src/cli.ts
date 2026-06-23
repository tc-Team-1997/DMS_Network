import { getKnex, destroyKnex } from "./index.js";

const cmd = process.argv[2];
const knex = getKnex();
try {
  if (cmd === "migrate") { await knex.migrate.latest(); console.log("migrations applied"); }
  else if (cmd === "rollback") { await knex.migrate.rollback(); console.log("rolled back"); }
  else if (cmd === "seed") { await knex.seed.run(); console.log("seed applied"); }
  else { console.error("usage: cli <migrate|rollback|seed>"); process.exit(1); }
} finally {
  await destroyKnex();
}
