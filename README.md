# WFS-T prototype for LuciadRIA 

## Description
The wfststore package provides WFS-T capabilities to a LuciadRIA Application.

Implements
* __Extends Get Capabilities to detect WFS-T__ 
* __Extends WFSFeatureStore to provide add, put, delete__ 
* __Extends WFSFeatureStore to provide getFeatureWithLock and LockFeature__ 

The Main Components are:

* __WFSTFeatureStore__: a ready to use LuciadRIA Feature store capable to retrieve features add, put, delete features
* __WFSTFeatureLockStore__:  a helper store to edit locked features


## To build
This is the source code that produces a library delivered as a npm package. 
To build the source code use the npm scripts:
```
npm install
npm run build
```
Then you can publish the package to npm or other repository

## To test
Some test have been added that runs using nodejs using Jest. No browser test is available at the moment.
The test uses isomorphic-fetch to provide fetch in node testing with jest.
```
npm run test
```
Test use the sever-side implementations, use GeoServer of LuciadFusion 


## To use in your project

Simply import the NPM package into your project

```
npm install wfststore
``` 


## Requirements
* LuciadRIA 2024.1 or higher (place it on a local npm repository for instance verdaccio )
* A ES6 or Typescript capable transpiler. 
