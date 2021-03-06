import Reconciler from "react-reconciler";
import { createContext } from "react";
import * as ReactIs from "react-is";
import _ from "lodash";
import fs from "fs";
import io from "@jscad/io";
import modeling from "@jscad/modeling";
import uuid from "uuid";

const DEFAULT_CACHE_DIR = ".render_cache";

const debug = require("debug")("landau-renderer");

const rendererContext = createContext({ cacheDir: DEFAULT_CACHE_DIR });

const createInstance = (
  type,
  props,
  rootContainer,
  hostContext,
  internalHandle
) => {
  const modelingOp =
    _.get(modeling, `colors.${type}`) ||
    _.get(modeling, `primitives.${type}`) ||
    _.get(modeling, `booleans.${type}`) ||
    _.get(modeling, `expansions.${type}`) ||
    _.get(modeling, `extrusions.${type}`) ||
    _.get(modeling, `hulls.${type}`) ||
    _.get(modeling, `modifiers.${type}`) ||
    _.get(modeling, `transforms.${type}`);
  debug("createInstance", type, props, internalHandle);
  if (!modelingOp) {
    throw new Error(`Unrecognized instance type ${type}`);
  }

  const fiberTree = buildFiberTree(internalHandle);
  const randomId = uuid.v4();
  return {
    id: randomId,
    type,
    props,
    fn: modelingOp,
    children: [],
    internalHandle,
  };
};

const buildFiberTree = (interalHandle) => {
  const findRootNode = (returnFiber) => {
    if (!returnFiber.return) {
      return returnFiber;
    }
    return findRootNode(returnFiber.return);
  };

  const rootNode = findRootNode(interalHandle.return);

  const buildTree = (node) => {
    const children = [];
    let siblingNode = node.child;
    while (siblingNode) {
      children.push(buildTree(siblingNode));
      siblingNode = siblingNode.sibling;
    }

    return {
      displayName:
        _.get(node, "elementType.name") || _.get(node, "elementType") || "Root",
      _randomId: _.get(node, "stateNode.id"),
      children,
    };
  };

  return buildTree(rootNode);
};

const renderPackage = (pkg, outputPath, cacheDir, cacheable) => {
  // TODO: proper args
  debug("props", pkg.props);
  const renderedChildren = pkg.children.map((child) => {
    return renderPackage(child);
  });

  const execPkgFn = (pkg) => {
    if (pkg.fn.length === 1) {
      const simpleArgFn = {
        colorize: "color",
        rotate: "angles",
        rotateX: "angle",
        rotateY: "angle",
        rotateZ: "angle",
        translate: "offset",
        translateX: "offset",
        translateY: "offset",
        translateZ: "offset",
        scale: "factors",
        scaleX: "factor",
        scaleY: "factor",
        scaleZ: "factor",
      };
      if (Object.keys(simpleArgFn).includes(pkg.type)) {
        return pkg.fn(pkg.props[simpleArgFn[pkg.type]], ...renderedChildren);
      }
      return pkg.fn(pkg.props, ...renderedChildren);
    } else {
      return pkg.fn(...renderedChildren);
    }
  };

  const csg = execPkgFn(pkg);
  // csg.fiberTree = pkg.fiberTree;
  csg.id = pkg.id;
  csg.children = renderedChildren;
  return csg;
};

const HostConfig = {
  now: Date.now,
  supportsMutation: true,
  getRootHostContext: (root) => {
    debug("getRootHostContext", root);
    return {
      MARKER: "HOST CONTEXT",
      outputPath: root.path,
      cacheDir: root.cacheDir || DEFAULT_CACHE_DIR,
    };
  },
  getChildHostContext: (parentContext, fiberType, rootInstance) => {
    debug("getChildHostContext", parentContext, fiberType, rootInstance);
    // return { MARKER: "CHILD HOST CONTEXT", outputPath: rootInstance.path };
    return { MARKER: "CHILD HOST CONTEXT" };
  },
  getPublicInstance: (instance) => instance,
  shouldSetTextContent: function (...args) {
    // debug('shouldSetTextContent', ...args)
    return false;
  },
  createInstance,
  createTextInstance: function (...args) {
    debug("createTextInstance", ...args);
  },
  appendInitialChild: (parent, child) => {
    debug("appendInitialChild", child);
    parent.children.push(child);
  },
  appendChildToContainer: (container, child, ...args) => {
    const outputPath = container.path;
    const cacheDir = container.cacheDir || DEFAULT_CACHE_DIR;
    debug("renderPackage", child, outputPath, ...args);
    const outputGeometry = renderPackage(child, outputPath, cacheDir, true);
    container.csg = outputGeometry;
    debug("internalHandle", child.internalHandle);
    container.csg.fiberTree = buildFiberTree(child.internalHandle);
    debug("geometry", outputGeometry);
    if (outputPath) {
      // TODO: make format configurable
      const rawData = io.solidsAsBlob(outputGeometry, { format: "stl" });
      fs.writeFileSync(outputPath, rawData.asBuffer());
    }
  },
  finalizeInitialChildren: function (...args) {
    return false;
  },
  clearContainer: function (container) {
    delete container.csg;
  },

  prepareForCommit: (container) => {},
  resetAfterCommit: (container) => {},
};

const roots = new Map();
const reconcilerInstance = Reconciler(HostConfig);

const render = (element, container, callback) => {
  // const cacheDir = container.cacheDir || DEFAULT_CACHE_DIR;
  // fs.mkdirSync(cacheDir, { recursive: true });
  // Hack to modify context
  // rendererContext._currentValue.cacheDir = cacheDir;
  // rendererContext._currentValue2.cacheDir = cacheDir;

  const isAsync = false; // Disables async rendering
  let root = roots.get(container);
  if (!root) {
    root = reconcilerInstance.createContainer(container, isAsync); // Creates root fiber node.
    roots.set(container, root);
  }

  const parentComponent = null; // Since there is no parent (since this is the root fiber). We set parentComponent to null.
  reconcilerInstance.updateContainer(element, root, parentComponent, callback); // Start reconcilation and render the result
};

export { render };
