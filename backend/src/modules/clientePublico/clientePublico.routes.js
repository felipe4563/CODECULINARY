const { Router } = require('express');
const ctrl = require('./clientePublico.controller');
const { authCliente } = require('../../middlewares/authCliente');

const router = Router();

router.post('/estado', ctrl.estado);
router.post('/pin/solicitar', ctrl.solicitarPin);
router.post('/pin/confirmar', ctrl.confirmarPin);
router.post('/pin/verificar', ctrl.verificarPin);
router.put('/pin', authCliente, ctrl.cambiarPin);
router.get('/perfil', authCliente, ctrl.perfil);

module.exports = router;
