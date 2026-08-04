const { Router } = require('express');
const ctrl = require('./cupones.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('cupones', 'ver'), ctrl.listar);
router.get('/validar/:codigo', verificarPermiso('ventas', 'crear'), ctrl.validar);
// Antes de "/:id" — si no, Express matchea esta ruta como :id.
router.get('/disponibles', verificarPermiso('ventas', 'crear'), ctrl.disponiblesPorCliente);
router.get('/:id', verificarPermiso('cupones', 'ver'), ctrl.obtener);
router.post('/', verificarPermiso('cupones', 'crear'), ctrl.crear);
router.put('/:id', verificarPermiso('cupones', 'editar'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('cupones', 'eliminar'), ctrl.eliminar);

module.exports = router;
