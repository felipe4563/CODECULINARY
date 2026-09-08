const { Router } = require('express');
const ctrl = require('./integracionesAdmin.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('configuracion', 'ver'), ctrl.listar);
router.post('/', verificarPermiso('configuracion', 'editar'), ctrl.crear);
router.post('/:id/desactivar', verificarPermiso('configuracion', 'editar'), ctrl.desactivar);
router.post('/:id/regenerar', verificarPermiso('configuracion', 'editar'), ctrl.regenerar);

module.exports = router;
