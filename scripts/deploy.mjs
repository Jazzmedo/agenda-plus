// Copies the built plugin into an Obsidian vault.
// Usage: node scripts/deploy.mjs [vaultPath]
//   or:  OBSIDIAN_VAULT=/path/to/vault node scripts/deploy.mjs
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_VAULT = "/home/hanafi/Documents/Obsidian-Claude";
const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT ?? DEFAULT_VAULT;

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const target = path.join(vault, ".obsidian", "plugins", manifest.id);

if (!fs.existsSync(path.join(vault, ".obsidian"))) {
	console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
	process.exit(1);
}

fs.mkdirSync(target, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	if (!fs.existsSync(file)) {
		console.error(`Missing ${file} — run "npm run build" first.`);
		process.exit(1);
	}
	fs.copyFileSync(file, path.join(target, file));
	console.log(`  ${file} -> ${path.join(target, file)}`);
}

console.log(`\nDeployed ${manifest.name} v${manifest.version}.`);
console.log("Reload Obsidian (Ctrl+R) or toggle the plugin off/on to pick up changes.");
