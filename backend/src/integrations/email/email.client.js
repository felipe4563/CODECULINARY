const nodemailer = require('nodemailer');

let _transporter = null;
function _obtenerTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: false, // STARTTLS sobre el puerto 587, no TLS implícito
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function enviarCodigoPin({ to, codigo }) {
  try {
    await _obtenerTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: 'Tu código para activar tu PIN',
      text: `Tu código para activar tu PIN es: ${codigo}\n\nVence en 10 minutos. Si no pediste esto, ignorá este mensaje.`,
    });
  } catch {
    throw Object.assign(new Error('No se pudo enviar el código por email. Intentá de nuevo.'), { status: 502 });
  }
}

module.exports = { enviarCodigoPin };
