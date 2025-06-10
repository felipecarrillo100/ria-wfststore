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


## To install in your project

Simply import the NPM package into your project

```
npm install wfststore
``` 

## To use in your project 


WFSTFeatureStore works as any other LuciadRIA Store that supports read/write. Therefore it is interchangeable with other stores.

You can use this store together with `FeatureModel` and `Featurelayer`.

### To query the service capabilities
Normally you should start by interrogating the server to detect if WFS-T is supported, you can do this with `WFSCapabilitiesExtended`


```Typescript
WFSCapabilitiesExtended.fromURL(request, options).then(({wfsCapabilities, wfstCapabilities}: WFSCapabilitiesExtendedResult) => {
        const wfstCapable = wfstCapabilities.WFSTCapable;
        const wfstOperations = wfstCapabilities.WFSTOperations;
})
    .catch((err) => {
        handleHTTPErrors.handleError(err);
    });
```
### Creating a simple WFS-T Store
* For this purpose use `WFSTFeatureStore`, then use it with 'FeatureModel' and `Featurelayer` and insert it to the map.
* You will need to wire to some Edit Controllers, you can refer to the LuciadRIA `Create and Edit` sample for that purpose.

```typescript
const store = new WFSTFeatureStore({...options, serviceURL: "yoururl"});
const model = new FeatureModel(store, {reference: store.getReference()});
const layer = new FeatureLayer(mdoel, {labe: "My WFST", editable: true});
```

### Creating a simple WFS-T Store
* For this purpose use `WFSTFeatureLockStore`
```typescript
const store = new WFSTFeatureLockStore({...options, serviceURL: "yoururl"});
const model = new FeatureModel(store, {reference: store.getReference()});
const layer = new FeatureLayer(mdoel, {labe: "My WFST", editable: true});
```



## Requirements
* LuciadRIA 2024.1 or higher (place it on a local npm repository for instance verdaccio )
* A ES6 or Typescript capable transpiler. 
