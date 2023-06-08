
import {DOMElement, addCustomElement} from 'fragelement';
import settings from '../../tinybuild.config'

let component = require('./socket.component.html');

//See: https://github.com/brainsatplay/domelement
export class Socket extends DOMElement {
    props={host:settings.server.host, port:settings.server.python, ws:undefined} //can specify properties of the element which can be subscribed to for changes.
    
    //set the template string or function (which can input props to return a modified string)
    template=component;

    //DOMElement custom callbacks:
    oncreate = (props) => {
        //let host = 'localhost';
        //let port = 7000;

        props.ws = new WebSocket(`ws://${props.host}:${props.port}/`); //var ws = new WebSocket('ws://' + document.domain + ':' + location.port + '/');
        props.ws.onmessage = (event) => {
            const messagesDOM = this.getElementsByTagName('ul')[0];
            const messageDOM = document.createElement('li');
            //const message = JSON.parse(event.data).message;
            const message = event.data;
            const contentDOM = document.createTextNode(message);
            messageDOM.appendChild(contentDOM);
            messagesDOM.appendChild(messageDOM);
        };
    }
    //onresize=(props)=>{} //on window resize
    //onchanged=(props)=>{} //on props changed
    ondelete=(props)=>{
        props.ws.close();
    } //on element deleted. Can remove with this.delete() which runs cleanup functions
}

//window.customElements.define('custom-', Custom);

addCustomElement(Socket,'socket-test');
