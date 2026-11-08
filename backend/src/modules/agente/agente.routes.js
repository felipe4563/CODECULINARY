const { Router } = require('express');
const ctrl = require('./agente.controller');

// Públicas a propósito (sin auth): el agente de impresión las consulta para auto-actualizarse.
const router = Router();

router.get('/version', ctrl.version);
router.get('/descargar', ctrl.descargar);

module.exports = router;
