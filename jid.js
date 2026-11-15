// "2348012345678:12@s.whatsapp.net" -> "2348012345678"
const numberOf = (jid) => String(jid || '').split('@')[0].split(':')[0];
module.exports = { numberOf };
