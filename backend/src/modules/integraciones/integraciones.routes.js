const { Router } = require('express');
const ctrl = require('./integraciones.controller');
const { authApiKeyExterna } = require('../../middlewares/authApiKeyExterna');

const router = Router();
router.use(authApiKeyExterna);

router.get('/menu', ctrl.obtenerMenu);
router.post('/cupones/validar', ctrl.validarCupon);
router.post('/pedidos', ctrl.crearPedido);
router.get('/pedidos/:pedido_id/estado', ctrl.estadoPedido);

module.exports = router;
