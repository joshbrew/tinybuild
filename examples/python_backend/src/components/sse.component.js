
import {DOMElement, addCustomElement} from 'fragelement';
import settings from '../../tinybuild.config'

let component = require('./sse.component.html');

//See: https://github.com/brainsatplay/domelement
export class SSE extends DOMElement {
    props={host:settings.server.host, port:settings.server.python, es:undefined} //can specify properties of the element which can be subscribed to for changes.
    
    //set the template string or function (which can input props to return a modified string)
    template=component;

    //DOMElement custom callbacks:
    oncreate=(props)=>{
        //let host = 'localhost';
        //let port = 7000;

        props.es = new EventSource(`http://${props.host}:${props.port}/sse`);
        props.es.onmessage = function (event) {
            console.log('Event Source:',event.data);
        };
    }
    //onresize=(props)=>{} //on window resize
    //onchanged=(props)=>{} //on props changed
    ondelete=(props)=>{
        props.es.close()
    } //on element deleted. Can remove with this.delete() which runs cleanup functions
}

//window.customElements.define('custom-', Custom);

addCustomElement(SSE,'sse-test');
