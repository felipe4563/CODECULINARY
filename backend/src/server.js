require('dotenv').config({ quiet: true });
const http = require('http');
const cron = require('node-cron');
const app = require('./app');
const { init: initSocket } = require('./socket');
const { sequelize } = require('./models');
const { generarCuponesCumpleanos } = require('./jobs/cumpleanos.job');

const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
initSocket(server);

function _correrJobCumpleanos() {
  generarCuponesCumpleanos()
    .then(({ generados }) => { if (generados > 0) console.log(`Cupones de cumpleaños generados: ${generados}`); })
    .catch(err => console.error('Error generando cupones de cumpleaños:', err));
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
  })
  .catch(err => {
    console.error('Error DB:', err);
    process.exit(1);
  });
