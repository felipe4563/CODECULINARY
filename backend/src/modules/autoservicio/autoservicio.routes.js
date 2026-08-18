const { Router } = require('express');
const ctrl = require('./autoservicio.controller');
const { authClienteOpcional } = require('../../middlewares/authCliente');

const router = Router();

router.get('/mesa/:codigo_qr', ctrl.obtenerMenu);
router.post('/mesa/:codigo_qr/cupon/validar', ctrl.validarCupon);
router.post('/mesa/:codigo_qr/pedido', authClienteOpcional, ctrl.crearPedido);
router.get('/mesa/:codigo_qr/pedido/:pedido_id/estado', ctrl.estadoPedido);

module.exports = router;
