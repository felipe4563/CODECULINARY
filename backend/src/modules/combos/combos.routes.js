const { Router } = require('express');
const ctrl = require('./combos.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('combos', 'ver'), ctrl.listar);
router.get('/activos', verificarPermiso('ventas', 'ver'), ctrl.listarActivos);
router.get('/:id', verificarPermiso('combos', 'ver'), ctrl.obtener);
router.post('/', verificarPermiso('combos', 'crear'), ctrl.crear);
router.put('/:id', verificarPermiso('combos', 'editar'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('combos', 'eliminar'), ctrl.eliminar);

module.exports = router;
