import * as React from 'react';
import {
    ScrollView,
    StyleSheet,
    Switch,
    View,
    Text,
    TouchableOpacity,
} from 'react-native';
import * as Location from 'expo-location';
import * as Permissions from 'expo-permissions';
import Constants from 'expo-constants';
import MapView, { Camera, Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import Banner from '../components/Banner';
import Button from '../components/Button';
import Error from '../components/Error';
import PhotoButton from '../components/PhotoButton';
import Question from '../components/Question';
import Selectable from '../components/Selectable';

import Options from '../constants/Options';
import Colors from '../constants/Colors';
import $S from '../styles';

import {connect} from 'react-redux';
import * as actions from '../redux/actions';
import {
    setUserData
} from '../firebase/auth';

import PlogScreenWeather from './PlogScreenWeather';

class PlogScreen extends React.Component {
    static modes = ['Log'];

    constructor(props) {
        super(props);
        this.state = {
            selectedMode: 0,
            trashTypes: {},
            activityType: ['walking'],
            groupType: ['alone'],
            plogPhotos: [null, null, null, null, null],
            timerInterval: null,
            plogStart: null,
            plogTotalTime: 0,
            plogTimer: '00:00:00',
            params: {
                homeBase: 'Boston, MA',
                username: 'Beach Bum'
            },

          shouldFollow: true,
          markedLocation: null,
          markedLocationInfo: null
        };
    }

  componentDidUpdate(prevProps, prevState) {
    if (!this.props.submitting && prevProps.submitting &&
        !this.props.error) {
      this.setState({
          trashTypes: {},
          selectedMode: 0,
          plogPhotos: [null, null, null, null, null],
          timerInterval: clearInterval(this.state.timerInterval),
          plogStart: null,
          plogTotalTime: 0,
          plogTimer: '00:00:00',

          markedLocation: null,
        markedLocationInfo: null,
      });

      this.props.navigation.navigate('History');
    }

    if (this.props.location && !prevProps.location) {
      this.mapView.animateCamera(this.makeCamera(), { duration: 200 });
    }
  }

  /**
   * @returns {Camera}
   */
  makeCamera = () => (this.props.location && {
    center: this.props.location,
    altitude: 1000,
    pitch: 0,
    heading: 0,
    zoom: 14
  })

  onClickRecenter = () => {
    this.setState({
      markedLocation: null,
      markedLocationInfo: null,
      shouldFollow: true
    });
    this.mapView.animateCamera(this.makeCamera(), { duration: 200 });
  }

  onPanDrag = e => {
    if (!this.state.markedLocation) {
      this.setState({
        shouldFollow: false,
        markedLocation: e.nativeEvent.coordinate
      });
    }
  }

  onRegionChangeComplete = region => {
    if (this.state.markedLocation) {
      const coordinates = {
        latitude: region.latitude,
        longitude: region.longitude,
      };
      this.setState({
        markedLocation: coordinates
      });

      Location.reverseGeocodeAsync(coordinates).then(locationInfo => {
        this.setState({
          markedLocationInfo: locationInfo[0]
        });
      }, console.warn);
    }
  }

    changeMode = (idx) => {
        this.setState({ selectedMode: idx });
    }

    get mode() {
        return PlogScreen.modes[this.state.selectedMode];
    }

    onSubmit = () => {
        if (!this.props.user) {
            console.warn('Unauthenticated user; skipping plog');
            return;
        }

      const coords = this.state.markedLocation || this.props.location,
            locationInfo = this.state.markedLocationInfo || this.props.locationInfo;
        const plog = {
            location: coords ? {lat: coords.latitude, lng: coords.longitude, name: locationInfo.street } : null,
            when: new Date(),
            pickedUp: this.mode === 'Log',
            trashTypes: Object.keys(this.state.trashTypes),
            activityType: this.state.activityType[0],
            groupType: this.state.groupType[0],
            plogPhotos: this.state.plogPhotos.filter(p=> p!=null),
            timeSpent: this.state.plogTotalTime + (this.state.plogStart ? Date.now() - this.state.plogStart : 0),
            public: this.props.user.data.shareActivity,
            userProfilePicture: this.props.user.data.profilePicture,
            userDisplayName: this.props.user.data.displayName,
        };
        this.props.logPlog(plog);
    }

    toggleTrashType = (trashType) => {
      this.setState(({trashTypes}) => {
        if (trashTypes[trashType])
          delete trashTypes[trashType];
        else
          trashTypes[trashType] = true;
        return { trashTypes };
      });
    }

    addPicture(picture, idx) {
        this.setState(({plogPhotos}) => {
            plogPhotos = Array.from(plogPhotos);
            plogPhotos[idx] = picture;

            return { plogPhotos };
        });
    }

    selectActivityType = (activity) => {
        this.setState(state => ({
            activityType: [activity]
        }));
    }

    selectGroupType = (group) => {
        this.setState(state => ({
            groupType: [group]
        }));
    }

    toggleTimer = () => {
        if(this.state.timerInterval) {
            this.setState(prevState => ({
                timerInterval: clearInterval(this.state.timerInterval),
                plogTotalTime: prevState.plogTotalTime + Date.now() - prevState.plogStart,
                plogStart: null
            }));
        } else {
            this.setState(prevState => ({
                timerInterval: setInterval(this.tick, 1000),
                plogStart: Date.now()
            }));
        }
    }

    clearTimer = () => {
        this.setState({
            timerInterval: clearInterval(this.state.timerInterval),
            plogStart: null,
            plogTotalTime: 0,
            plogTimer: '00:00:00',
        });
    }

    tick = () => {
        let difference = (Date.now() - this.state.plogStart + this.state.plogTotalTime) / 1000;
        let hours   = Math.floor(difference / 3600);
        let minutes = Math.floor((difference - (hours * 3600)) / 60);
        let seconds = Math.floor(difference - (hours * 3600) - (minutes * 60));

        if (hours   < 10) {hours   = "0"+hours;}
        if (minutes < 10) {minutes = "0"+minutes;}
        if (seconds < 10) {seconds = "0"+seconds;}

        this.setState({plogTimer: `${hours}:${minutes}:${seconds}`});
    }

    async componentDidMount() {
        let { status } = await Permissions.askAsync(Permissions.LOCATION);
        if (status === 'granted') {
            this.props.startWatchingLocation();
        }
    }

    componentWillUnmount() {
        this.setState({timerInterval: clearInterval(this.state.timerInterval)});
    }

    renderModeQuestions(mode=this.mode) {
        const {state} = this,
              activityName = Options.activities.get(state.activityType[0]).title,
              groupName = Options.groups.get(state.groupType[0]).title;

        switch (mode) {
        case 'Log':
            return (
                <>
                  <Question question="What were you up to?" answer={activityName}/>
                  <Selectable selection={state.activityType}>
                    {Array.from(Options.activities).map(([value, type]) => {
                        const { buttonIcon: ButtonIcon=type.icon } = this.props;
                        const activityIcon = <ButtonIcon fill="#666666" />;
                        return (
                            <Button title={type.title} 
                                value={value} 
                                icon={activityIcon} 
                                key={value}
                                onPress={() => this.selectActivityType(value)} 
                            />
                        )
                    }
                    )}
                  </Selectable>

                  <Question question="Who helped?" answer={groupName} />
                  <Selectable selection={state.groupType}>
                    {Array.from(Options.groups).map(([value, type]) => {
                        const { buttonIcon: ButtonIcon=type.icon } = this.props;
                        const peopleIcon = <ButtonIcon fill="#666666" />;
                        return (
                            <Button title={type.title} 
                                value={value} 
                                icon={peopleIcon} 
                                key={value}
                                onPress={() => this.selectGroupType(value)}
                            />
                        )
                    }
                    )}
                  </Selectable>
                </>
            );
        }

        return null;
    }

    render() {
        const {state} = this,
              trashTypes = Object.keys(state.trashTypes),
              typesCount = trashTypes.length,
              cleanedUp = typesCount > 1 ? `${typesCount} selected` :
              typesCount ? Options.trashTypes.get(trashTypes[0]).title : '',
              {params} = this.state,
              {user, error} = this.props,
              locationInfo = state.markedLocationInfo || this.props.locationInfo;
      const ActivityIcon = Options.activities.get(state.activityType[0]).icon;

      const firstNullIdx = this.state.plogPhotos.findIndex(p => !p);
    return (
        <ScrollView style={$S.screenContainer} contentContainerStyle={$S.scrollContentContainer}>

            <PlogScreenWeather />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8, paddingTop: 10 }}>
            <Text style={{ fontWeight: '500', paddingLeft: 10 }}>
              {locationInfo ? `Plogging near ${locationInfo.street}` : ' '}
            </Text>
            <Text style={styles.timer}>
              {/* <Text onPress={this.clearTimer} style={styles.clearButton}>clear</Text> */}
              <Text> </Text>
              {this.state.plogTimer}
            </Text>
          </View>

            <View style={styles.mapContainer}>
                <MapView
                    ref={mapView => this.mapView = mapView}
                    style={[styles.map]}
                    initialCamera={this.makeCamera()}
                    showsMyLocationButton={true}
                    showsTraffic={false}
                    showsUserLocation={true}
                    followsUserLocation={this.state.shouldFollow}
                    onPanDrag={this.onPanDrag}
                    onRegionChangeComplete={this.onRegionChangeComplete}
                    zoomControlEnabled={false}
                />
              {state.markedLocation &&
               <View style={styles.markedLocationIconContainer} pointerEvents="none">
                 <ActivityIcon
                   width={40}
                   height={40}
                   fill={Colors.activeColor}
                 />
               </View>
              }

                <View style={styles.timerButtonContainer} >
                    <Button
                        title={this.state.timerInterval ? 'STOP TIMER' : 'START TIMER'}
                        onPress={this.toggleTimer}
                        style={styles.timerButton}
                        selected={!!this.state.timerInterval}
                    />
                </View>

              <View style={styles.myLocationButtonContainer}>
                <TouchableOpacity onPress={this.onClickRecenter}
                                  accessibilityLabel="Recenter map"
                                  accessibilityRole="button"
                >
                  <Ionicons name="md-locate" size={20} style={styles.myLocationButton} />
                </TouchableOpacity>
              </View>

            </View>

            <View style={styles.photoStrip}>
                {
                  this.state.plogPhotos.map((plogPhoto, idx) => (
                    <PhotoButton onPictureSelected={picture => this.addPicture(picture, Math.min(idx, firstNullIdx))}
                                 style={styles.photoButton}
                                 imageStyle={{ resizeMode: 'contain', width: '90%', height: '80%' }}
                                 onCleared={_ => this.addPicture(null, idx)}
                                 photo={plogPhoto}
                                 key={idx}
                                 manipulatorActions={[
                                   { resize: { width: 300, height: 300 } },
                                 ]}
                    />
                  ))
                }
            </View>

            <Question question="What did you clean up?" answer={cleanedUp}/>
            <Selectable selection={trashTypes} >
                {Array.from(Options.trashTypes).map(([value, type]) => (
                    <Button title={type.title} value={value} icon={type.icon} key={value}
                            onPress={() => this.toggleTrashType(value)}
                    />
                ))}
            </Selectable>

          {this.renderModeQuestions()}

          {error && <Error error={error}/>}

            <Button title={PlogScreen.modes[this.state.selectedMode]}
                    disabled={!this.props.user || this.props.submitting}
                    primary
                    onPress={this.onSubmit}
            />
            <View style={[$S.switchInputGroup, styles.shareInLocalFeed]}>
                <Text style={$S.inputLabel}>
                    Share in Local Feed
                </Text>
              <Switch value={this.props.user && (this.props.user.data || {}).shareActivity}
                      style={$S.switch}
                      onValueChange={() => { setUserData({ shareActivity: !this.props.user.data.shareActivity }); }}
                />
            </View>

        </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
    photoStrip: {
        flex: 1,
        flexDirection: 'row',
        marginTop: 10,
        justifyContent: 'space-around'
    },

    photoButton: {
        flex: 1,
        marginHorizontal: 7,
        aspectRatio: 1,
    },

    mapContainer: {
        borderColor: Colors.borderColor,
        borderWidth: 1,
        flex: 1,
        height: 300,
        margin: 5,
        position: 'relative'
    },

    map: {
        width: '100%',
        height: '100%'
    },

    timerButton: {
        width: '30%',
        margin: 'auto',
        backgroundColor: 'white'
    },

    timerButtonContainer: {
        alignItems: 'center',
        position: 'absolute',
        bottom: '10%',
        left: 0,
        width: '100%'
    },

    timer: {
        textAlign: 'right',
        paddingRight: 5
    },

  myLocationButtonContainer: {
    height: '100%',
    padding: 10,
    paddingBottom: 20,
    position: 'absolute',
  },

  myLocationButton: {
    backgroundColor: 'white',
    borderColor: 'black',
    borderRadius: 5,
    borderWidth: 1,
    padding: 5,
    paddingBottom: 2,
  },

  markedLocationIconContainer: {
    position: 'absolute',
    height: '100%',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

    clearButton: {
        color: 'grey',
        textDecorationLine: 'underline'
    },

    shareInLocalFeed: {
        margin: 10,
        marginLeft: 40,
        marginRight: 40,
        marginBottom: 20,
    },
});

const PlogScreenContainer = connect(({users, log}) => ({
  user: users.current,
  location: users.location,
  locationInfo: users.locationInfo,
  submitting: log.submitting,
  error: log.logError,
}),
                                    (dispatch) => ({
                                        logPlog(plogInfo) {
                                            dispatch(actions.logPlog(plogInfo));
                                        },
                                        startWatchingLocation() {
                                            dispatch(actions.startWatchingLocation());
                                        }
                                    }))(PlogScreen);

export default PlogScreenContainer;
