const { Router } = require('express');
const ctrl = require('./impresion.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/estado-agentes', verificarPermiso('caja', 'ver'), ctrl.estadoAgentes);

module.exports = router;
