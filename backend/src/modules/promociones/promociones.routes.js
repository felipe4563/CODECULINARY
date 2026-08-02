const { Router } = require('express');
const ctrl = require('./promociones.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('promociones', 'ver'), ctrl.listar);
router.get('/activas', verificarPermiso('ventas', 'ver'), ctrl.listarActivas);
router.get('/:id', verificarPermiso('promociones', 'ver'), ctrl.obtener);
router.post('/', verificarPermiso('promociones', 'crear'), ctrl.crear);
router.put('/:id', verificarPermiso('promociones', 'editar'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('promociones', 'eliminar'), ctrl.eliminar);

module.exports = router;
