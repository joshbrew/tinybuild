
import {DOMElement, addCustomElement} from 'fragelement';
//import {settings} from '../../node_server/server_settings'

let component = require('./component.html');

//See: https://github.com/brainsatplay/domelement
export class Custom extends DOMElement {
    props={} //can specify properties of the element which can be subscribed to for changes.
    
    //set the template string or function (which can input props to return a modified string)
    template=component;

    //DOMElement custom callbacks:
    oncreate=(props)=>{
        //let host = 'localhost';
        //let port = 7000;

        console.log("Custom html component created!");
    }
    //onresize=(props)=>{} //on window resize
    //onchanged=(props)=>{} //on props changed
    ondelete=(props)=>{
       console.log("Custom html component deleted!")
    } //on element deleted. Can remove with this.delete() which runs cleanup functions
}

//window.customElements.define('custom-', Custom);

addCustomElement(Custom,'custom-');
