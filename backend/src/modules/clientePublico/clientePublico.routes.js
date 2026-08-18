const { Router } = require('express');
const ctrl = require('./clientePublico.controller');

const router = Router();

router.post('/estado', ctrl.estado);
router.post('/pin/solicitar', ctrl.solicitarPin);
router.post('/pin/confirmar', ctrl.confirmarPin);

module.exports = router;
