require('dotenv').config({ quiet: true });
const http = require('http');
const cron = require('node-cron');
const app = require('./app');
const { init: initSocket } = require('./socket');
const { sequelize } = require('./models');
const { generarCuponesCumpleanos } = require('./jobs/cumpleanos.job');
const { expirarPagosQrVencidos } = require('./jobs/expirarPagosQr.job');
const { resetDisponibilidadDiaria } = require('./jobs/resetDisponibilidad.job');

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
initSocket(server);

function _correrJobCumpleanos() {
  generarCuponesCumpleanos()
    .then(({ generados }) => { if (generados > 0) console.log(`Cupones de cumpleaños generados: ${generados}`); })
    .catch(err => console.error('Error generando cupones de cumpleaños:', err));
}

function _correrJobExpirarPagosQr() {
  expirarPagosQrVencidos()
    .then(({ revertidos }) => { if (revertidos > 0) console.log(`Pagos QR vencidos revertidos: ${revertidos}`); })
    .catch(err => console.error('Error revirtiendo pagos QR vencidos:', err));
}

function _correrJobResetDisponibilidad() {
  resetDisponibilidadDiaria()
    .then(({ afectados }) => { if (afectados > 0) console.log(`Disponibilidad diaria reseteada: ${afectados} producto(s)`); })
    .catch(err => console.error('Error reseteando disponibilidad diaria:', err));
}

sequelize.authenticate()
  .then(() => {
    console.log('DB conectada');
    server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

    // Corre una vez al iniciar (por si el servidor estuvo caído el día que
    // tocaba) y luego todos los días a las 08:00 hora Bolivia. Es seguro
    // llamarlo varias veces el mismo día: el código del cupón incluye el
    // año, así que un cliente ya procesado se salta sin duplicar.
    _correrJobCumpleanos();
    cron.schedule('0 8 * * *', _correrJobCumpleanos, { timezone: 'America/La_Paz' });

    // Corre cada 5 minutos para limpiar pagos QR vencidos. No depende de
    // hora de negocio, así que corre siempre sin timezone.
    cron.schedule('*/5 * * * *', _correrJobExpirarPagosQr);

    // Corre todas las noches a las 06:00 hora Bolivia para resetear la
    // disponibilidad diaria de todos los productos. A diferencia de los
    // otros jobs de este archivo, este NO corre también al iniciar el
    // servidor — es destructivo (borra las marcas de "no disponible" del
    // día), así que un reinicio a mitad de turno no debe pisar lo que el
    // personal ya configuró hoy. El costo de un 06:00 perdido (el servidor
    // estuvo caído) es que ayer's flags persisten un rato de más — el lado
    // seguro del error, porque oculta un plato de más en vez de vender uno
    // que no existe.
    cron.schedule('0 6 * * *', _correrJobResetDisponibilidad, { timezone: 'America/La_Paz' });
  })
  .catch(err => {
    console.error('Error DB:', err);
    process.exit(1);
  });
