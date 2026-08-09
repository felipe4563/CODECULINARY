const { Router } = require('express');
const ctrl = require('./insumos.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');
const { requiereSucursalActiva } = require('../../middlewares/sucursalActiva');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('insumos', 'ver'), ctrl.listarInsumos);
router.post('/', verificarPermiso('insumos', 'crear'), ctrl.crearInsumo);
router.put('/:id', verificarPermiso('insumos', 'editar'), ctrl.actualizarInsumo);
router.delete('/:id', verificarPermiso('insumos', 'eliminar'), ctrl.desactivarInsumo);
router.put('/:id/ajustar-stock', verificarPermiso('insumos', 'editar'), requiereSucursalActiva, ctrl.ajustarStock);

router.get('/receta/:producto_id', verificarPermiso('insumos', 'ver'), ctrl.obtenerReceta);
router.put('/receta/:producto_id', verificarPermiso('insumos', 'editar'), ctrl.guardarReceta);

router.get('/reportes/total-gastado', verificarPermiso('insumos', 'ver'), ctrl.totalGastado);
router.get('/reportes/compras', verificarPermiso('insumos', 'ver'), ctrl.reporteCompras);

module.exports = router;
