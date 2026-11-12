import bcrypt from "bcryptjs";
const password=process.argv[2];
if(!password || password.length<12){console.error("Usage: node scripts/hash-password.mjs 'at-least-12-character-password'");process.exit(1)}
console.log(bcrypt.hashSync(password,12));
